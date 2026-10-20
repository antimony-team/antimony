import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

import {Collection, CollectionIn} from '@sb/types/domain/collection';
import {
  InstanceNode,
  InstanceOut,
  LabIn,
  LabOut,
  NodeInterface,
} from '@sb/types/domain/lab';
import {
  CaptureConfig,
  DeploymentConfig,
  ServerConfig,
  SSHConfig,
} from '@sb/types/domain/server-config';
import {BindFile, BindFileIn, TopologyOut} from '@sb/types/domain/topology';
import {AuthConfig, User} from '@sb/types/domain/user';
import {ErrorCodes} from '@sb/types/error-codes';

/*
 * Checks the interface's types of the API against the server in this repository: the fields of the
 * types against the server's swagger, and the error codes against the codes the server sends.
 *
 * The key lists are typed with all keys of the interface's types, so the compiler keeps them in line
 * with the types, and the test keeps them in line with the server.
 */

const SERVER_DIR = path.resolve(import.meta.dirname, '../../../server/src');

const swagger = JSON.parse(
  readFileSync(path.join(SERVER_DIR, 'docs/swagger.json'), 'utf8'),
) as {definitions: Record<string, {properties?: Record<string, unknown>}>};

function keys<T>(fields: Record<keyof T, true>) {
  return Object.keys(fields);
}

const TYPES: Record<string, string[]> = {
  'transport.LabOut': keys<LabOut>({
    id: true,
    name: true,
    startTime: true,
    endTime: true,
    topologyId: true,
    creator: true,
    collectionId: true,
    topologyDefinition: true,
    topologyAnnotations: true,
    instance: true,
  }),
  'lab.LabIn': keys<LabIn>({
    name: true,
    startTime: true,
    endTime: true,
    topologyId: true,
  }),
  'transport.InstanceOut': keys<InstanceOut>({
    name: true,
    deployed: true,
    state: true,
    latestStateChange: true,
    nodes: true,
    isRecovered: true,
  }),
  'instance.InstanceNode': keys<InstanceNode>({
    name: true,
    kind: true,
    ipv4: true,
    ipv6: true,
    containerId: true,
    containerName: true,
    interfaces: true,
    state: true,
    isReady: true,
    canRestart: true,
  }),
  'deployment.NodeInterface': keys<NodeInterface>({
    name: true,
    address: true,
    mtu: true,
    state: true,
  }),
  'transport.TopologyOut': keys<TopologyOut>({
    id: true,
    collectionId: true,
    definition: true,
    annotations: true,
    syncUrl: true,
    creator: true,
    bindFiles: true,
    lastDeployFailed: true,
    policyFindings: true,
  }),
  'transport.BindFileOut': keys<BindFile>({
    id: true,
    filePath: true,
    content: true,
    topologyId: true,
  }),
  'topology.BindFileIn': keys<BindFileIn>({filePath: true, content: true}),
  'transport.CollectionOut': keys<Collection>({
    id: true,
    creator: true,
    name: true,
    publicWrite: true,
    publicDeploy: true,
  }),
  'collection.CollectionIn': keys<CollectionIn>({
    name: true,
    publicWrite: true,
    publicDeploy: true,
  }),
  'transport.UserOut': keys<User>({id: true, name: true}),
  'user.AuthConfigOut': keys<AuthConfig>({methods: true}),
  'serverconfig.ServerConfig': keys<ServerConfig>({
    ssh: true,
    capture: true,
    deployment: true,
  }),
  'serverconfig.SSHConfig': keys<SSHConfig>({enabled: true, port: true}),
  'serverconfig.CaptureConfig': keys<CaptureConfig>({
    enabled: true,
    excludedInterfaces: true,
  }),
  'serverconfig.DeploymentConfig': keys<DeploymentConfig>({provider: true}),
};

// HTTP statuses the server also sends as codes, which the data binder handles by status
const HTTP_AUTH_CODES = [401, 403, 498];

describe('the API types', () => {
  for (const [name, fields] of Object.entries(TYPES)) {
    it(`have the fields of ${name}`, () => {
      const properties = Object.keys(
        swagger.definitions[name]?.properties ?? {},
      );
      expect(properties, `${name} is not in the swagger`).not.toEqual([]);

      // Fields the interface has, but the server doesn't (extra), and the other way round (missing)
      expect({
        extra: fields.filter(field => !properties.includes(field)).sort(),
        missing: properties.filter(field => !fields.includes(field)).sort(),
      }).toEqual({extra: [], missing: []});
    });
  }
});

describe('the error codes', () => {
  it('have every code the server sends', () => {
    const source = readFileSync(
      path.join(SERVER_DIR, 'utils/response.go'),
      'utf8',
    );
    const serverCodes = new Set(
      [...source.matchAll(/Code: (\d+)/g)].map(match => Number(match[1])),
    );
    const codes = new Set(Object.values(ErrorCodes));

    const missing = [...serverCodes]
      .filter(code => !codes.has(code) && !HTTP_AUTH_CODES.includes(code))
      .sort((a, b) => a - b);

    expect(missing).toEqual([]);
  });
});
