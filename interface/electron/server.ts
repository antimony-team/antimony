import {randomBytes} from 'node:crypto';
import {createWriteStream, mkdirSync, writeFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {app} from 'electron';
import {parse, stringify} from 'yaml';

import {
  checkEngine,
  DockerError,
  followLogs,
  hasImage,
  pullImage,
  removeContainer,
  runContainer,
  waitForExit,
} from './docker';
import configOverrides from './config.yml?raw';

// The container of the app's server, there is only one at a time
const CONTAINER_NAME = 'antimony-desktop';

// How long the server may take to answer after its container started
const SERVER_START_TIMEOUT = 30_000;

// What the interface needs to talk to the server, see preload.ts
export interface DesktopConfig {
  serverUrl: string;
  token: string;
}

export interface RunningServer {
  desktop: DesktopConfig;

  // Resolves with the exit code when the server stops
  exited: Promise<number>;
}

// Packaged builds that aren't a release, such as local builds, have a version like 0.0.0-dev
function isDevelopmentVersion() {
  return app.getVersion().endsWith('-dev');
}

/*
 * The image of the server. A release uses the server of the same version, a packaged development
 * build the image published from the development branch, and an unpackaged build the image
 * `task build-docker` builds in the backend. SB_SERVER_IMAGE overrides all of them.
 */
export function serverImage() {
  if (process.env.SB_SERVER_IMAGE) return process.env.SB_SERVER_IMAGE;
  if (!app.isPackaged) return 'antimony-server:dev';

  return `ghcr.io/antimony-team/antimony-server:${isDevelopmentVersion() ? 'dev' : app.getVersion()}`;
}

// A port that is free right now, picked by the operating system
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function secret() {
  return randomBytes(32).toString('hex');
}

type Config = Record<string, unknown>;

function isObject(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Merges the values of the second config into the first, nested objects are merged as well
function mergeConfig(base: Config, values: Config): Config {
  const merged = {...base};
  for (const [key, value] of Object.entries(values)) {
    merged[key] =
      isObject(merged[key]) && isObject(value)
        ? mergeConfig(merged[key], value)
        : value;
  }
  return merged;
}

/*
 * Writes the server's config: the overrides of electron/config.yml, and on top of them the ports and
 * the paths in the app's data folder, which change with every start or every machine.
 */
function writeConfig(dataDir: string, port: number, sshPort: number) {
  const config = mergeConfig((parse(configOverrides) as Config) ?? {}, {
    server: {host: '127.0.0.1', port},
    ssh: {
      sshHost: '127.0.0.1',
      sshPort,
      sshKeyPath: path.join(dataDir, 'ssh_host_key'),
    },
    database: {localFile: path.join(dataDir, 'antimony.db')},
    filesystem: {
      storage: path.join(dataDir, 'storage') + path.sep,
      run: path.join(dataDir, 'run') + path.sep,
    },
    containerlab: {kindsConfig: path.join(dataDir, 'kinds.conf.yml')},
  });

  const configPath = path.join(dataDir, 'config.yml');
  writeFileSync(configPath, stringify(config));

  return configPath;
}

// Makes sure the image is there, downloads it if not. A local development image can't be downloaded.
async function ensureImage(
  image: string,
  onStatus: (text: string, progress?: number) => void,
) {
  const isPresent = await hasImage(image);

  /*
   * The development image is replaced with every change of the development branch, so a newer one
   * is downloaded on every start. Without a connection, the one that is already there is used.
   */
  const isMovingTag =
    app.isPackaged && isDevelopmentVersion() && !process.env.SB_SERVER_IMAGE;

  if (isPresent && !isMovingTag) return;

  if (!app.isPackaged && !process.env.SB_SERVER_IMAGE) {
    throw new DockerError(
      `The image ${image} doesn’t exist. Build it with “task build-docker” in antimony-server, ` +
        'or set SB_SERVER_IMAGE to another image.',
    );
  }

  const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);
  onStatus(
    isPresent
      ? 'Checking for a newer Antimony server…'
      : 'Downloading the Antimony server…',
    isPresent ? undefined : 0,
  );

  try {
    await pullImage(image, (current, total) => {
      if (total === 0) return;
      onStatus(
        `Downloading the Antimony server… ${megabytes(current)} of ${megabytes(total)} MB`,
        current / total,
      );
    });
  } catch (error) {
    if (!isPresent) throw error;

    console.warn(
      `Couldn't check for a newer ${image}, using the one that is there`,
      error,
    );
  }
}

// Resolves once the server answers, rejects if it stops or doesn't answer in time
async function waitForServer(serverUrl: string, exited: Promise<number>) {
  let exitCode: number | null = null;
  void exited.then(code => (exitCode = code));

  const deadline = Date.now() + SERVER_START_TIMEOUT;
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new DockerError(
        `The Antimony server stopped while starting (code ${exitCode}).`,
      );
    }

    try {
      const response = await fetch(`${serverUrl}/users/login/auth-config`);
      if (response.ok) return;
    } catch {
      // The server isn't listening yet
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new DockerError('The Antimony server didn’t start in time.');
}

/**
 * Starts the server in a container, on free ports and with a login token that is new on every
 * start. Its output goes to the app's output and to server.log in the app's data folder.
 */
export async function startServer(
  onStatus: (text: string, progress?: number) => void,
): Promise<RunningServer> {
  onStatus('Checking Docker…');
  await checkEngine();

  const image = serverImage();
  await ensureImage(image, onStatus);

  onStatus('Starting the Antimony server…');

  // A server left over from an earlier start that didn't end cleanly
  await removeContainer(CONTAINER_NAME);

  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, {recursive: true});

  const port = await freePort();
  const sshPort = await freePort();
  const token = secret();
  const configPath = writeConfig(dataDir, port, sshPort);

  // Like the server of the Docker deployment, see docker-compose.yml in the antimony repository
  const id = await runContainer(CONTAINER_NAME, {
    Image: image,
    Cmd: [`-config=${configPath}`, '-sqlite'],
    Env: [
      `SB_DESKTOP_TOKEN=${token}`,
      // Nobody signs in as the admin in the desktop app, the password only keeps the account closed
      'SB_ADMIN_USERNAME=admin',
      `SB_ADMIN_PASSWORD=${secret()}`,
      `SB_JWT_SECRET=${secret()}`,
    ],
    User: 'root',
    HostConfig: {
      Privileged: true,
      NetworkMode: 'host',
      PidMode: 'host',
      CgroupnsMode: 'host',
      Binds: [
        '/var/run/docker.sock:/var/run/docker.sock',
        '/var/run/netns:/var/run/netns',
        '/var/lib/docker:/var/lib/docker',
        '/etc/hosts:/etc/hosts',
        // containerlab passes bind file paths to the host's Docker, so the folder has the same path in the container
        `${dataDir}:${dataDir}`,
      ],
    },
  });

  const log = createWriteStream(path.join(dataDir, 'server.log'), {flags: 'a'});
  void followLogs(id, (stream, data) => {
    log.write(data);
    (stream === 'stderr' ? process.stderr : process.stdout).write(data);
  });

  const exited = waitForExit(id);
  const serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer(serverUrl, exited);

  return {desktop: {serverUrl, token}, exited};
}

// Stops and removes the server's container
export async function stopServer() {
  await removeContainer(CONTAINER_NAME);
}
