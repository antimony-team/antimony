import {ValidateFunction} from 'ajv';
import {observable, runInAction} from 'mobx';
import {vi} from 'vitest';

import {BindFileDocument} from '@sb/lib/editor/document/bind-file-document';
import {TopologyDocument} from '@sb/lib/editor/document/topology-document';
import {DraftStorage} from '@sb/lib/editor/draft-storage';
import {ContainerlabFormat} from '@sb/lib/format/containerlab/containerlab-format';
import {CollectionStore} from '@sb/lib/stores/collection-store';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {EditorTabStore} from '@sb/lib/stores/editor-tab-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {
  BindFile,
  Topology,
  TopologyAnnotations,
  TopologyIn,
} from '@sb/types/domain/topology';
import {TopologyDefinition} from '@sb/types/domain/topology-definition';
import {Result} from '@sb/types/result';
import {FetchState} from '@sb/types/types';

/*
 * The fakes and the setup the tests of the editor documents and tabs share.
 */

// Every topology passes the schema, the tests are about editing
export const format = new ContainerlabFormat(
  () => (() => true) as unknown as ValidateFunction,
);

export const TOPOLOGY = `name: test
topology:
  nodes:
    r1:
      kind: nokia_srlinux
    r2:
      kind: nokia_srlinux
    pc:
      kind: linux
  links:
    - endpoints: ["r1:e1-1", "r2:e1-1"]
    - endpoints: ["r2:e1-2", "pc:eth1"]
`;

export const ANNOTATIONS: TopologyAnnotations = {
  nodeAnnotations: [
    {id: 'r1', position: {x: 0, y: 0}},
    {id: 'r2', position: {x: 100, y: 0}},
    {id: 'pc', position: {x: 200, y: 0}},
  ],
};

export function read(source: string): TopologyDefinition {
  return format.read(source)!;
}

export function createTopology(
  source = TOPOLOGY,
  annotations: TopologyAnnotations = ANNOTATIONS,
  id = 'topology-id',
): Topology {
  return observable(
    {
      id,
      collectionId: 'collection-id',
      creator: {id: 'user-id', name: 'user'},
      syncUrl: '',
      bindFiles: [],
      lastDeployFailed: false,
      definition: read(source),
      annotations: structuredClone(annotations),
    },
    {definition: observable.ref, annotations: observable.ref},
  );
}

/**
 * The parts of the topology store the documents use. Updates are applied to
 * the lookup like the store does after it fetched the topology again.
 */
export class FakeTopologyStore {
  public format = format;
  public lookup = observable.map<string, Topology>();
  public bindFileLookup = observable.map<string, BindFile>();
  public fetchReport = observable({state: FetchState.Done});
  public isEditable = true;
  public updateResult: Result<DataResponse<void>> = Result.createOk({
    payload: undefined,
  });
  public updates: {id: string; body: Partial<TopologyIn>}[] = [];
  public bindFileUpdates: {id: string; content?: string}[] = [];

  public canEdit() {
    return this.isEditable;
  }

  public async update(id: string, body: Partial<TopologyIn>) {
    this.updates.push({id, body});
    if (this.updateResult.isOk()) this.store(id, body);
    return this.updateResult;
  }

  public async updateBindFile(
    _topologyId: string,
    id: string,
    body: {content?: string},
  ) {
    this.bindFileUpdates.push({id, content: body.content});
    if (this.updateResult.isOk() && body.content !== undefined) {
      runInAction(() => {
        this.bindFileLookup.set(id, {
          ...this.bindFileLookup.get(id)!,
          content: body.content!,
        });
      });
    }
    return this.updateResult;
  }

  // Changes the saved version, as if it was saved somewhere else
  public store(id: string, body: Partial<TopologyIn>) {
    const topology = this.lookup.get(id)!;

    runInAction(() => {
      if (body.definition) topology.definition = read(body.definition);
      if (body.annotations) topology.annotations = JSON.parse(body.annotations);
    });
  }
}

export class FakeDeviceStore {
  public data = [{kind: 'nokia_srlinux'}];

  public getInterfaceConfig(kind?: string) {
    if (kind === 'nokia_srlinux') {
      return {interfaces: [{pattern: 'e1-$', start: 1}]};
    }
    return {interfaces: [{pattern: 'eth$', start: 1}]};
  }
}

// The tests run without a browser, so the local storage is kept in memory
export class MemoryStorage {
  private items = new Map<string, string>();

  get length() {
    return this.items.size;
  }

  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.items.set(key, value);
  }

  removeItem(key: string) {
    this.items.delete(key);
  }
}

/**
 * Fake stores and the drafts of a user, fresh for every test, and the
 * documents and tabs made with them. Timers are fake, so drafts are written
 * with vi.runOnlyPendingTimers().
 */
export class EditorTestBed {
  public readonly topologyStore = new FakeTopologyStore();
  public readonly deviceStore = new FakeDeviceStore();
  public readonly collectionStore = {
    lookup: observable.map([
      [
        'collection-id',
        {
          id: 'collection-id',
          name: 'collection',
          creator: {id: 'user-id', name: 'user'},
          publicWrite: true,
          publicDeploy: true,
        },
      ],
    ]),
    canDeployIn: () => true,
  };
  public readonly schemaStore = {annotationsValidator: null};
  public readonly drafts = new DraftStorage('user-id');
  public readonly dataBinder = observable({isLoggedIn: true});

  public topologyDocument(topology: Topology, drafts = this.drafts) {
    return new TopologyDocument(
      topology,
      this.topologyStore as unknown as TopologyStore,
      this.collectionStore as unknown as CollectionStore,
      this.deviceStore as unknown as DeviceStore,
      this.schemaStore as unknown as SchemaStore,
      drafts,
    );
  }

  public bindFileDocument(bindFile: BindFile) {
    return new BindFileDocument(
      bindFile,
      this.topologyStore as unknown as TopologyStore,
      this.drafts,
    );
  }

  public tabStore() {
    return new EditorTabStore(
      this.dataBinder,
      this.topologyStore as unknown as TopologyStore,
      this.collectionStore as unknown as CollectionStore,
      this.deviceStore as unknown as DeviceStore,
      this.schemaStore as unknown as SchemaStore,
    );
  }

  public addTopology(topology = createTopology()) {
    runInAction(() => this.topologyStore.lookup.set(topology.id, topology));
    return topology;
  }

  public addBindFile(content = 'hostname r1\n'): BindFile {
    const bindFile = {
      id: 'file-id',
      topologyId: 'topology-id',
      filePath: 'configs/r1.cfg',
      content,
    };
    runInAction(() => {
      this.topologyStore.bindFileLookup.set(bindFile.id, bindFile);
      this.topologyStore.lookup
        .get(bindFile.topologyId)
        ?.bindFiles.push(bindFile);
    });
    return bindFile;
  }
}

export function setUpEditorTest(): EditorTestBed {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', new MemoryStorage());
  return new EditorTestBed();
}

export function tearDownEditorTest() {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}
