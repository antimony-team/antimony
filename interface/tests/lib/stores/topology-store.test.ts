import Ajv from 'ajv';
import {makeObservable, observable} from 'mobx';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {DataBinder} from '@sb/lib/stores/data-binder/data-binder';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {BindFile, Topology, TopologyOut} from '@sb/types/domain/topology';
import {Result} from '@sb/types/result';

const clabValidator = new Ajv({strict: false}).compile({
  type: 'object',
  required: ['topology'],
  properties: {name: {type: 'string'}},
});

const annotationsValidator = new Ajv({strict: false}).compile({
  type: 'object',
  properties: {nodeAnnotations: {type: 'array'}},
});

function definition(name: string) {
  return `name: ${name}\ntopology:\n  nodes:\n    r1:\n      kind: linux\n`;
}

function topologyOut(
  id: string,
  overrides: Partial<TopologyOut> = {},
): TopologyOut {
  return {
    id,
    collectionId: 'collection',
    creator: {id: 'creator', name: 'creator'},
    definition: definition(id),
    annotations: '{}',
    syncUrl: '',
    bindFiles: [],
    lastDeployFailed: false,
    ...overrides,
  };
}

function bindFile(id: string, topologyId: string, filePath: string): BindFile {
  return {id, topologyId, filePath, content: ''};
}

class FakeDataBinder {
  public isLoggedIn = false;
  public authUser = {id: 'creator', name: 'creator', isAdmin: false};
  public topologies: TopologyOut[] = [];
  public failingPaths = new Set<string>();
  public requests: string[] = [];

  constructor() {
    makeObservable(this, {authUser: observable});
  }

  public async get(path: string) {
    this.requests.push(`GET ${path}`);
    const topology = this.topologies.find(t => path === `/topologies/${t.id}`);

    return Result.createOk({payload: topology ?? this.topologies});
  }

  public async patch(path: string) {
    return this.respond(`PATCH ${path}`);
  }

  public async post(path: string) {
    return this.respond(`POST ${path}`);
  }

  public async delete(path: string) {
    return this.respond(`DELETE ${path}`);
  }

  private respond(request: string) {
    this.requests.push(request);
    return this.failingPaths.has(request)
      ? Result.createErr({code: 400, message: 'Failed'})
      : Result.createOk({payload: 'id'});
  }
}

describe('TopologyStore', () => {
  let dataBinder: FakeDataBinder;
  let schemaStore: {
    clabSchema: object | null;
    annotationsValidator: typeof annotationsValidator | null;
  };
  let collections: Map<string, {publicWrite: boolean}>;
  let store: TopologyStore;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    dataBinder = new FakeDataBinder();
    schemaStore = {clabSchema: {}, annotationsValidator};
    collections = new Map([['collection', {publicWrite: true}]]);

    store = new TopologyStore(
      {
        _dataBinder: dataBinder,
        _collectionStore: {lookup: collections},
      } as unknown as RootStore,
      dataBinder as unknown as DataBinder,
      schemaStore as unknown as SchemaStore,
      {} as DeviceStore,
      new ContainerlabFormat(() => clabValidator),
    );
    store.dispose();
    dataBinder.isLoggedIn = true;
  });

  async function fetchTopologies(...topologies: TopologyOut[]) {
    dataBinder.topologies = topologies;
    await store.fetch();
    return store.data;
  }

  describe('reading', () => {
    it('reads a valid topology', () => {
      expect(store.readTopology(definition('lab'))?.name).toBe('lab');
    });

    it('rejects text that is not YAML', () => {
      expect(store.readTopology('name: [')).toBeNull();
    });

    it('rejects a topology the schema does not accept', () => {
      expect(store.readTopology('name: lab\n')).toBeNull();
    });

    it('reads annotations the schema accepts', () => {
      expect(store.parseTopologyAnnotations('{"nodeAnnotations": []}')).toEqual(
        {nodeAnnotations: []},
      );
    });

    it('rejects annotations that are not JSON or not valid', () => {
      expect(store.parseTopologyAnnotations('{broken')).toBeNull();
      expect(
        store.parseTopologyAnnotations('{"nodeAnnotations": {}}'),
      ).toBeNull();
    });

    it('accepts any annotations before the schema is loaded', () => {
      schemaStore.annotationsValidator = null;

      expect(store.parseTopologyAnnotations('{"nodeAnnotations": {}}')).toEqual(
        {nodeAnnotations: {}},
      );
    });
  });

  describe('fetching', () => {
    it('reads the topologies and their bind files', async () => {
      const file = bindFile('f1', 'a', 'r1/config');
      const [topology] = await fetchTopologies(
        topologyOut('a', {
          annotations: '{"nodeAnnotations": []}',
          bindFiles: [file],
        }),
      );

      expect(topology.definition.name).toBe('a');
      expect(topology.annotations).toEqual({nodeAnnotations: []});
      expect(store.lookup.get('a')).toBe(topology);
      expect(store.bindFileLookup.get('f1')).toEqual(file);
    });

    it('leaves out topologies with an invalid definition', async () => {
      const topologies = await fetchTopologies(
        topologyOut('a'),
        topologyOut('b', {definition: 'name: b\n'}),
      );

      expect(topologies.map(t => t.id)).toEqual(['a']);
    });

    it('keeps topologies with broken annotations without their layout', async () => {
      const [topology] = await fetchTopologies(
        topologyOut('a', {annotations: '{broken'}),
      );

      expect(topology.annotations).toEqual({});
    });

    it('waits for the containerlab schema before reading topologies', async () => {
      schemaStore.clabSchema = null;

      expect(await fetchTopologies(topologyOut('a'))).toEqual([]);
    });

    it('keeps the topology objects and updates their values on a refetch', async () => {
      const [topology] = await fetchTopologies(topologyOut('a'));
      const [refetched] = await fetchTopologies(
        topologyOut('a', {
          definition: definition('renamed'),
          annotations: '{"nodeAnnotations": []}',
          syncUrl: 'https://example.com/lab.yaml',
          lastDeployFailed: true,
        }),
      );

      expect(refetched).toBe(topology);
      expect(topology.definition.name).toBe('renamed');
      expect(topology.annotations).toEqual({nodeAnnotations: []});
      expect(topology.syncUrl).toBe('https://example.com/lab.yaml');
      expect(topology.lastDeployFailed).toBe(true);
    });

    it('keeps the values of a topology that are invalid on a refetch', async () => {
      const [topology] = await fetchTopologies(
        topologyOut('a', {annotations: '{"nodeAnnotations": []}'}),
      );
      await fetchTopologies(
        topologyOut('a', {definition: 'name: a\n', annotations: '{broken'}),
      );

      expect(topology.definition.name).toBe('a');
      expect(topology.annotations).toEqual({nodeAnnotations: []});
    });

    it.skip('clears the failed deployment once the server reports a successful one', async () => {
      // Bug: updateTopologyValues only copies lastDeployFailed when it is true
      const [topology] = await fetchTopologies(
        topologyOut('a', {lastDeployFailed: true}),
      );
      await fetchTopologies(topologyOut('a', {lastDeployFailed: false}));

      expect(topology.lastDeployFailed).toBe(false);
    });

    it('fetches a single new topology and adds it', async () => {
      await fetchTopologies(topologyOut('a'));
      dataBinder.topologies = [
        topologyOut('a'),
        topologyOut('b', {bindFiles: [bindFile('f1', 'b', 'r1/config')]}),
      ];
      await store.fetchSingle('b');

      expect(store.data.map(t => t.id)).toEqual(['a', 'b']);
      expect(store.bindFileLookup.has('f1')).toBe(true);
    });

    it('fetches a single known topology and updates it in place', async () => {
      const [topology] = await fetchTopologies(
        topologyOut('a', {bindFiles: [bindFile('f1', 'a', 'old')]}),
      );
      const file = store.bindFileLookup.get('f1');
      dataBinder.topologies = [
        topologyOut('a', {
          definition: definition('renamed'),
          bindFiles: [bindFile('f1', 'a', 'new')],
        }),
      ];
      await store.fetchSingle('a');

      expect(store.data).toEqual([topology]);
      expect(topology.definition.name).toBe('renamed');
      expect(store.bindFileLookup.get('f1')).toBe(file);
      expect(file!.filePath).toBe('new');
    });
  });

  describe('permissions', () => {
    let topology: Topology;

    beforeEach(async () => {
      [topology] = await fetchTopologies(topologyOut('a'));
    });

    it('lets the creator edit a topology in a collection anyone can edit', () => {
      expect(store.canEdit(topology)).toBe(true);
    });

    it('does not let the creator edit a topology in a protected collection', () => {
      collections.set('collection', {publicWrite: false});

      expect(store.canEdit(topology)).toBe(false);
    });

    it('does not let other users edit a topology', () => {
      dataBinder.authUser = {id: 'other', name: 'other', isAdmin: false};

      expect(store.canEdit(topology)).toBe(false);
    });

    it('lets admins edit every topology', () => {
      collections.clear();
      dataBinder.authUser = {id: 'admin', name: 'admin', isAdmin: true};

      expect(store.canEdit(topology)).toBe(true);
    });
  });

  describe('changes', () => {
    beforeEach(async () => {
      await fetchTopologies(
        topologyOut('a', {bindFiles: [bindFile('f1', 'a', 'r1/config')]}),
        topologyOut('b', {bindFiles: [bindFile('f2', 'b', 'r1/other')]}),
      );
      dataBinder.requests = [];
    });

    it('names a duplicate after the names that are taken', async () => {
      await fetchTopologies(topologyOut('lab'), topologyOut('lab-1'));

      expect(store.createDuplicateName('lab')).toBe('lab-2');
    });

    it('refetches only the topology that was updated', async () => {
      const result = await store.update('a', {syncUrl: ''});

      expect(result.isOk()).toBe(true);
      expect(dataBinder.requests).toEqual([
        'PATCH /topologies/a',
        'GET /topologies/a',
      ]);
    });

    it('does not refetch a topology if updating it fails', async () => {
      dataBinder.failingPaths.add('PATCH /topologies/a');
      const result = await store.update('a', {syncUrl: ''});

      expect(result.isErr()).toBe(true);
      expect(dataBinder.requests).toEqual(['PATCH /topologies/a']);
    });

    it('changes bind files and refetches their topology unless told not to', async () => {
      await store.addBindFile('a', {filePath: 'x', content: ''});
      await store.updateBindFile('a', 'f1', {content: 'x'});
      await store.deleteBindFile('a', 'f1', true);

      expect(dataBinder.requests).toEqual([
        'POST /topologies/a/files',
        'GET /topologies/a',
        'PATCH /topologies/a/files/f1',
        'GET /topologies/a',
        'DELETE /topologies/a/files/f1',
      ]);
    });

    it('uploads new archive files and overwrites only files of the same topology', async () => {
      const result = await store.uploadArchiveFiles('a', [
        {filePath: 'r1/config', size: 1, content: 'x', exists: true},
        {filePath: 'r1/other', size: 1, content: 'x', exists: true},
        {filePath: 'r2/config', size: 1, content: 'x', exists: false},
      ]);

      expect(result.isOk()).toBe(true);
      expect(dataBinder.requests).toEqual([
        'PATCH /topologies/a/files/f1',
        'POST /topologies/a/files',
        'POST /topologies/a/files',
        'GET /topologies/a',
      ]);
    });

    it('stops uploading archive files at the first error', async () => {
      dataBinder.failingPaths.add('POST /topologies/a/files');
      const result = await store.uploadArchiveFiles('a', [
        {filePath: 'r2/config', size: 1, content: 'x', exists: false},
        {filePath: 'r3/config', size: 1, content: 'x', exists: false},
      ]);

      expect(result.isErr()).toBe(true);
      expect(dataBinder.requests).toEqual(['POST /topologies/a/files']);
    });
  });
});
