import {spawnSync} from 'node:child_process';
import {io} from 'socket.io-client';

import {ApiError, InstanceState, topologyDefinition} from '../fixtures/api';
import {expect, knownBug, test} from '../fixtures/test';
import {BACKEND_URL} from '../settings';

/*
 * Server behaviour that the interface relies on but can't show directly: what is enforced when, and who
 * hears about what. Most of these are known bugs found while reading the server's code.
 */

const unsafe = (name: string) =>
  `name: ${name}\ntopology:\n  nodes:\n    host1:\n      kind: linux\n      image: alpine:latest\n      privileged: true\n`;

test('a lab created from a safe topology can not be deployed once it is unsafe', async ({
  api,
  createCollection,
  createTopology,
  createUser,
  uniqueName,
}) => {
  knownBug(
    'the topology policy is only checked when a lab is created, not when it is deployed later',
  );
  const collection = await createCollection({publicDeploy: true});
  const topology = await createTopology({collection, nodes: ['host1']});
  const user = await createUser({collections: [collection]});
  const labId = await user.api.createLab(topology.id, uniqueName('lab'));

  // The admin changes the topology afterwards
  await api.updateTopology(topology.id, {definition: unsafe(topology.name)});

  const answer = await user.api.command(0, labId);
  if (!answer.code) await api.destroyLab(labId).catch(() => {});
  expect(answer.code).toBe(5403);
});

test("users don't hear about labs of collections they aren't in", async ({
  api,
  createLab,
  createUser,
}) => {
  knownBug(
    'status messages and lab updates about every lab are sent to every signed-in user',
  );
  const lab = await createLab();
  const outsider = await createUser();
  const received: string[] = [];
  const token = await outsider.api.accessToken();
  const sockets = ['status-messages', 'lab-updates'].map(namespace => {
    const socket = io(`${BACKEND_URL}/${namespace}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: {token},
    });
    socket.on('data', (data: unknown) => received.push(JSON.stringify(data)));
    return socket;
  });
  await expect.poll(() => sockets.every(socket => socket.connected)).toBe(true);

  await api.deployLab(lab.id);

  // Give the messages time to arrive, then check none of them is about the lab
  await new Promise(resolve => setTimeout(resolve, 2000));
  sockets.forEach(socket => socket.disconnect());
  expect(
    received.filter(
      message => message.includes(lab.id) || message.includes(lab.name),
    ),
  ).toEqual([]);
});

test('destroying a lab that is not running leaves its schedule alone', async ({
  api,
  createLab,
}) => {
  knownBug(
    'destroying a lab that is not running removes it from the schedule before failing, so it never starts',
  );
  const lab = await createLab({startTime: new Date(Date.now() + 3000)});

  const answer = await api.command(1, lab.id);
  expect(answer.code).toBe(5012);

  // The lab should still start at its start time
  await api.waitForLab(
    lab.id,
    l => l.instance?.state === InstanceState.Running,
  );
});

test('a page of labs is full for users who are not admins', async ({
  createCollection,
  createLab,
  createUser,
}) => {
  knownBug(
    "GET /labs applies limit and offset before leaving out other collections' labs, so pages come back short",
  );
  const theirs = await createCollection();
  const mine = await createCollection();
  // Other labs first, so they fill the first page before the filter runs
  await createLab({collection: theirs});
  await createLab({collection: theirs});
  const myLab = await createLab({collection: mine});
  const user = await createUser({collections: [mine]});

  const page = await user.api.call<{id: string}[]>('GET', '/labs?limit=1');

  expect(page.map(lab => lab.id)).toEqual([myLab.id]);
});

test('a lab can not end before it starts', async ({
  api,
  createTopology,
  uniqueName,
}) => {
  knownBug('the server accepts labs whose end time is before their start time');
  const topology = await createTopology();
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);

  const error = await api
    .createLab(topology.id, uniqueName('lab'), {
      startTime: start,
      endTime: new Date(start.getTime() - 60 * 60 * 1000),
    })
    .then(
      id => api.deleteLab(id).then(() => null),
      e => e as ApiError,
    );

  expect(error?.status).toBe(400);
});

test('the SSH server asks who is connecting', async ({createLab}) => {
  knownBug(
    'the SSH server accepts every connection without authentication and opens shells on any running node',
  );
  test.skip(
    spawnSync('ssh', ['-V']).error !== undefined,
    'needs the ssh client',
  );
  const lab = await createLab({deployed: true});

  const result = spawnSync(
    'ssh',
    [
      '-p',
      '6200',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
      '-tt',
      `${lab.topology.collection.name}/${lab.name}/host1@127.0.0.1`,
    ],
    {input: 'exit\r', timeout: 10_000, encoding: 'utf8'},
  );

  // Without credentials (BatchMode can't ask for any), the server must refuse
  expect(result.stdout).not.toContain('Connected to host1');
});

test('collection and lab names are checked on the server', async ({
  api,
  createTopology,
}) => {
  knownBug(
    'the server accepts empty collection and lab names, and slashes in collection names',
  );
  const topology = await createTopology();

  const emptyLab = await api.raw('POST', '/labs', {
    name: '',
    topologyId: topology.id,
    startTime: new Date(Date.now() + 3600_000).toISOString(),
  });
  const slashCollection = await api.raw('POST', '/collections', {
    name: 'a/b',
    publicWrite: false,
    publicDeploy: false,
  });
  // Clean up whatever was created
  for (const response of [emptyLab, slashCollection]) {
    const id = (await response.json().catch(() => ({})))?.payload;
    if (response.ok() && id) {
      await api.raw(
        'DELETE',
        response === emptyLab ? `/labs/${id}` : `/collections/${id}`,
      );
    }
  }

  expect(emptyLab.status()).toBe(400);
  expect(slashCollection.status()).toBe(400);
});

test('topologies keep a definition that the server validated', async ({
  api,
  createCollection,
  uniqueName,
}) => {
  const collection = await createCollection();

  const response = await api.raw('POST', '/topologies', {
    collectionId: collection.id,
    definition: `name: ${uniqueName('t')}\ntopology:\n  nodes:\n    a:\n      kind: 42\n`,
    annotations: '{}',
    syncUrl: '',
  });

  expect(response.status()).toBe(400);
  expect((await response.json()).code).toBe(3003);
  // A valid one is accepted
  const id = await api.createTopology(
    collection.id,
    topologyDefinition(uniqueName('t')),
  );
  await api.deleteTopology(id);
});
