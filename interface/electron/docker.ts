import {existsSync} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/*
 * A small client for the Docker Engine API. The app talks to the API directly instead of running the
 * docker command, so it gets the download progress and never puts secrets on a command line.
 */

// The socket of Docker Engine. Docker Desktop runs containers in a VM, where labs don't work.
const ENGINE_SOCKET = '/var/run/docker.sock';
const DESKTOP_SOCKET = path.join(os.homedir(), '.docker/desktop/docker.sock');

// An error the user can act on, shown to them as it is
export class DockerError extends Error {}

interface Response {
  status: number;
  body: string;
}

function request(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: ENGINE_SOCKET,
        path: apiPath,
        method,
        headers: body ? {'Content-Type': 'application/json'} : {},
      },
      resolve,
    );
    req.once('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function call(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<Response> {
  const response = await request(method, apiPath, body);

  let text = '';
  for await (const chunk of response) text += chunk;

  return {status: response.statusCode ?? 0, body: text};
}

// The message of an error response of the API
function errorMessage(response: Response) {
  try {
    return (JSON.parse(response.body) as {message?: string}).message ?? '';
  } catch {
    return response.body;
  }
}

/**
 * Checks that Docker Engine is installed, running and usable by this user. Throws a DockerError
 * with what to do otherwise, also if only Docker Desktop is installed.
 */
export async function checkEngine() {
  if (process.platform !== 'linux') {
    throw new DockerError(
      'The Antimony desktop app runs on Linux only, because labs need Docker Engine on Linux.',
    );
  }

  const desktopMessage =
    'Antimony needs Docker Engine, but only Docker Desktop was found. Docker Desktop runs ' +
    'containers in a virtual machine, where labs can’t reach the network. Install Docker Engine: ' +
    'https://docs.docker.com/engine/install/';

  if (!existsSync(ENGINE_SOCKET)) {
    throw new DockerError(
      existsSync(DESKTOP_SOCKET)
        ? desktopMessage
        : 'Antimony needs Docker Engine to run labs. Install it and start it: ' +
          'https://docs.docker.com/engine/install/',
    );
  }

  let info: Response;
  try {
    info = await call('GET', '/info');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES') {
      throw new DockerError(
        `You aren’t allowed to use Docker. Add your user to the docker group with ` +
          `“sudo usermod -aG docker ${os.userInfo().username}”, then log out and in again.`,
      );
    }

    throw new DockerError(
      'Docker Engine isn’t running. Start it, for example with “sudo systemctl start docker”.',
    );
  }

  const {OperatingSystem} = JSON.parse(info.body) as {OperatingSystem?: string};
  if (OperatingSystem?.includes('Docker Desktop')) {
    throw new DockerError(desktopMessage);
  }
}

export async function hasImage(image: string) {
  const response = await call(
    'GET',
    `/images/${encodeURIComponent(image)}/json`,
  );
  return response.status === 200;
}

// An image name split into its repository and tag, e.g. ghcr.io/a/b:1.0 into ghcr.io/a/b and 1.0
function splitImage(image: string) {
  const separator = image.lastIndexOf(':');
  return separator > image.lastIndexOf('/')
    ? {repository: image.slice(0, separator), tag: image.slice(separator + 1)}
    : {repository: image, tag: 'latest'};
}

/**
 * Downloads an image. The progress is reported in bytes over all layers whose size is known so far,
 * so the total grows while the download starts.
 */
export async function pullImage(
  image: string,
  onProgress: (current: number, total: number) => void,
) {
  const {repository, tag} = splitImage(image);
  const response = await request(
    'POST',
    `/images/create?fromImage=${encodeURIComponent(repository)}&tag=${encodeURIComponent(tag)}`,
  );

  if (response.statusCode !== 200) {
    let body = '';
    for await (const chunk of response) body += chunk;
    throw new DockerError(
      `The Antimony server ${image} couldn’t be downloaded: ${errorMessage({status: response.statusCode ?? 0, body})}`,
    );
  }

  // The API reports the progress as one JSON object per line
  const layers = new Map<string, {current: number; total: number}>();
  let buffer = '';

  for await (const chunk of response) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line) as {
        id?: string;
        status?: string;
        error?: string;
        progressDetail?: {current?: number; total?: number};
      };

      if (event.error) {
        throw new DockerError(
          `The Antimony server ${image} couldn’t be downloaded: ${event.error}`,
        );
      }
      if (!event.id) continue;

      const layer = layers.get(event.id);
      if (event.status === 'Downloading' && event.progressDetail?.total) {
        layers.set(event.id, {
          current: event.progressDetail.current ?? 0,
          total: event.progressDetail.total,
        });
      } else if (event.status === 'Download complete' && layer) {
        layer.current = layer.total;
      }

      const values = [...layers.values()];
      onProgress(
        values.reduce((sum, value) => sum + value.current, 0),
        values.reduce((sum, value) => sum + value.total, 0),
      );
    }
  }
}

export interface ContainerSpec {
  Image: string;
  Cmd: string[];
  Env: string[];
  User: string;
  HostConfig: {
    Privileged: boolean;
    NetworkMode: string;
    PidMode: string;
    CgroupnsMode: string;
    Binds: string[];
  };
}

// Creates and starts a container, returns its ID
export async function runContainer(name: string, spec: ContainerSpec) {
  const created = await call(
    'POST',
    `/containers/create?name=${encodeURIComponent(name)}`,
    spec,
  );
  if (created.status !== 201) {
    throw new DockerError(
      `The Antimony server couldn’t be created: ${errorMessage(created)}`,
    );
  }

  const {Id: id} = JSON.parse(created.body) as {Id: string};
  const started = await call('POST', `/containers/${id}/start`);
  if (started.status !== 204) {
    throw new DockerError(
      `The Antimony server couldn’t be started: ${errorMessage(started)}`,
    );
  }

  return id;
}

// Stops and removes a container, nothing happens if it doesn't exist
export async function removeContainer(name: string) {
  await call('DELETE', `/containers/${encodeURIComponent(name)}?force=true`);
}

// Resolves with the exit code once the container has stopped
export async function waitForExit(id: string) {
  const response = await call('POST', `/containers/${id}/wait`);
  try {
    return (JSON.parse(response.body) as {StatusCode: number}).StatusCode;
  } catch {
    return -1;
  }
}

/*
 * Follows the output of a container. Without a terminal, Docker sends both streams in one, each
 * frame with an 8 byte header: the stream (1 output, 2 errors), three empty bytes and the length.
 */
export async function followLogs(
  id: string,
  onOutput: (stream: 'stdout' | 'stderr', data: Buffer) => void,
) {
  const response = await request(
    'GET',
    `/containers/${id}/logs?follow=1&stdout=1&stderr=1`,
  );

  let buffer = Buffer.alloc(0);
  for await (const chunk of response) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);

    while (buffer.length >= 8) {
      const length = buffer.readUInt32BE(4);
      if (buffer.length < 8 + length) break;

      onOutput(
        buffer[0] === 2 ? 'stderr' : 'stdout',
        buffer.subarray(8, 8 + length),
      );
      buffer = buffer.subarray(8 + length);
    }
  }
}
