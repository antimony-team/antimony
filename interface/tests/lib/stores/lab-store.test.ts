import {makeObservable, observable, runInAction} from 'mobx';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DataBinder} from '@sb/lib/stores/data-binder/data-binder';
import {LabStore} from '@sb/lib/stores/lab-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {
  InstanceOut,
  InstanceState,
  Lab,
  LabOut,
  RuntimeCommand,
} from '@sb/types/domain/lab';
import {ErrorCodes} from '@sb/types/error-codes';
import {Result} from '@sb/types/result';

const NOW = new Date('2026-01-01T12:00:00Z');

const format = new ContainerlabFormat(() => null);

type Callback = (data: unknown) => void;

class FakeDataBinder {
  public isLoggedIn = true;
  public authUser = {id: 'user', name: 'user', isAdmin: false};
  public labs: LabOut[] = [];
  public headers: Headers | undefined = undefined;
  public requests: string[] = [];
  public callbacks = new Map<string, Callback>();
  public emitted: unknown[] = [];
  public ack: unknown = {payload: null};

  constructor() {
    makeObservable(this, {isLoggedIn: observable, authUser: observable});
  }

  public async get(path: string) {
    this.requests.push(path);
    const lab = this.labs.find(lab => path === `/labs/${lab.id}`);
    if (lab) return Result.createOk({payload: lab});

    return Result.createOk({payload: this.labs, headers: this.headers});
  }

  public subscribeNamespace(namespace: string, onData?: Callback) {
    if (onData) this.callbacks.set(namespace, onData);

    return {
      namespace,
      socket: {
        emitWithAck: async (_event: string, data: string) => {
          this.emitted.push(JSON.parse(data));
          return this.ack;
        },
      },
    };
  }

  public unsubscribeNamespace(namespace: string) {
    this.callbacks.delete(namespace);
  }
}

function labOut(id: string, overrides: Partial<LabOut> = {}): LabOut {
  return {
    id,
    name: id,
    startTime: NOW.toISOString(),
    topologyId: 'topology',
    creator: {id: 'creator', name: 'creator'},
    collectionId: 'collection',
    topologyDefinition: 'name: lab\ntopology:\n  nodes: {}\n',
    topologyAnnotations: '{}',
    instance: null,
    ...overrides,
  };
}

function instance(state: InstanceState): InstanceOut {
  return {
    name: 'instance',
    deployed: '2026-01-01T11:00:00Z' as unknown as Date,
    state,
    latestStateChange: NOW,
    nodes: [
      {
        name: 'r1',
        kind: 'linux',
        ipv4: '',
        ipv6: '',
        port: 22,
        user: '',
        containerId: 'container',
        containerName: 'r1',
        interfaces: [],
        state: 2,
        isReady: true,
        canRestart: true,
      },
    ],
    isRecovered: false,
  };
}

function minutes(offset: number) {
  return new Date(NOW.getTime() + offset * 60_000).toISOString();
}

describe('LabStore', () => {
  let dataBinder: FakeDataBinder;
  let clock: {now: number};
  let collectionStore: {fetch: () => Promise<void>};
  let statusMessageStore: {error: (message: string, title: string) => void};
  let store: LabStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    dataBinder = new FakeDataBinder();
    clock = observable({now: NOW.getTime()});
    collectionStore = {fetch: vi.fn(async () => {})};
    statusMessageStore = {error: vi.fn()};

    const topologyStore = {
      readTopology: (text: string) =>
        text.includes('invalid') ? null : format.read(text),
      parseTopologyAnnotations: (text: string) => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
    };

    store = new LabStore(
      {
        _dataBinder: dataBinder,
        _clockStore: clock,
        _collectionStore: collectionStore,
      } as unknown as RootStore,
      dataBinder as unknown as DataBinder,
      topologyStore as unknown as TopologyStore,
      statusMessageStore as unknown as StatusMessageStore,
    );
  });

  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function fetchLabs(...labs: LabOut[]) {
    dataBinder.labs = labs;
    await store.fetch();
    return store.data;
  }

  function lab(id: string): Lab {
    return store.lookup.get(id)!;
  }

  describe('states', () => {
    it('takes the state of the instance of a lab', async () => {
      const [running, failed] = await fetchLabs(
        labOut('running', {instance: instance(InstanceState.Running)}),
        labOut('failed', {instance: instance(InstanceState.Failed)}),
      );

      expect(running.state).toBe(InstanceState.Running);
      expect(failed.state).toBe(InstanceState.Failed);
    });

    it('schedules a lab without an instance that starts in the future', async () => {
      const [scheduled] = await fetchLabs(
        labOut('scheduled', {startTime: minutes(10), endTime: minutes(60)}),
      );

      expect(scheduled.state).toBe(InstanceState.Scheduled);
    });

    it('still schedules a lab that started a few seconds ago', async () => {
      const [justStarted] = await fetchLabs(
        labOut('lab', {
          startTime: new Date(NOW.getTime() - 3000).toISOString(),
        }),
      );

      expect(justStarted.state).toBe(InstanceState.Scheduled);
    });

    it('marks a lab without an instance as inactive once it should have started', async () => {
      const [lateWithoutEnd, lateWithEnd, ended] = await fetchLabs(
        labOut('a', {startTime: minutes(-10)}),
        labOut('b', {startTime: minutes(-10), endTime: minutes(10)}),
        labOut('c', {startTime: minutes(-60), endTime: minutes(-10)}),
      );

      expect(lateWithoutEnd.state).toBe(InstanceState.Inactive);
      expect(lateWithEnd.state).toBe(InstanceState.Inactive);
      expect(ended.state).toBe(InstanceState.Inactive);
    });

    it('updates scheduled labs as time passes', async () => {
      store.init(false);
      await fetchLabs(
        labOut('soon', {startTime: minutes(1)}),
        labOut('later', {startTime: minutes(60)}),
      );

      vi.setSystemTime(new Date(NOW.getTime() + 2 * 60_000));
      runInAction(() => (clock.now = Date.now()));

      expect(lab('soon').state).toBe(InstanceState.Inactive);
      expect(lab('later').state).toBe(InstanceState.Scheduled);
    });

    it('keeps the labs as they are if no state changes with time', async () => {
      store.init(false);
      await fetchLabs(labOut('later', {startTime: minutes(60)}));
      const data = store.data;

      runInAction(() => (clock.now = Date.now() + 1000));

      expect(store.data).toBe(data);
    });
  });

  describe('parsing', () => {
    it('reads the times, the instance and the topology of a lab', async () => {
      const [parsed] = await fetchLabs(
        labOut('lab', {
          endTime: minutes(60),
          instance: instance(InstanceState.Running),
          topologyAnnotations: '{"nodeAnnotations": []}',
        }),
      );

      expect(parsed.startTime).toEqual(NOW);
      expect(parsed.endTime).toEqual(new Date(minutes(60)));
      expect(parsed.instance!.deployed).toEqual(
        new Date('2026-01-01T11:00:00Z'),
      );
      expect(parsed.instance!.nodeMap.get('r1')?.containerId).toBe('container');
      expect(parsed.topologyDefinition.definition.name).toBe('lab');
      expect(parsed.topologyDefinition.annotations).toEqual({
        nodeAnnotations: [],
      });
    });

    it('has no end time if the lab runs indefinitely', async () => {
      const [parsed] = await fetchLabs(labOut('lab'));

      expect(parsed.endTime).toBeNull();
      expect(parsed.instance).toBeNull();
    });

    it('leaves out labs with an invalid topology', async () => {
      const labs = await fetchLabs(
        labOut('valid'),
        labOut('broken', {topologyDefinition: 'invalid'}),
      );

      expect(labs.map(lab => lab.id)).toEqual(['valid']);
      expect(store.lookup.has('broken')).toBe(false);
    });

    it('keeps labs with broken annotations without their layout', async () => {
      const [parsed] = await fetchLabs(
        labOut('lab', {topologyAnnotations: '{broken'}),
      );

      expect(parsed.topologyDefinition.annotations).toEqual({});
    });

    it('reads the total number of labs from the headers', async () => {
      dataBinder.headers = new Headers({'X-Total-Count': '42'});
      await fetchLabs(labOut('lab'));

      expect(store.totalEntries).toBe(42);
    });
  });

  describe('permissions', () => {
    beforeEach(async () => {
      await fetchLabs(
        labOut('inactive'),
        labOut('deploying', {instance: instance(InstanceState.Deploying)}),
        labOut('running', {instance: instance(InstanceState.Running)}),
        labOut('stopping', {instance: instance(InstanceState.Stopping)}),
        labOut('failed', {instance: instance(InstanceState.Failed)}),
      );
    });

    const allowed = (check: (lab: Lab) => boolean) =>
      store.data.filter(check).map(lab => lab.id);

    it('lets only the creator and admins control a lab', () => {
      expect(store.canControl(lab('running'))).toBe(false);

      runInAction(() => (dataBinder.authUser.id = 'creator'));
      expect(store.canControl(lab('running'))).toBe(true);

      runInAction(
        () =>
          (dataBinder.authUser = {
            ...dataBinder.authUser,
            id: 'x',
            isAdmin: true,
          }),
      );
      expect(store.canControl(lab('running'))).toBe(true);
    });

    it('deploys only labs without an instance', () => {
      expect(allowed(lab => store.canDeploy(lab))).toEqual(['inactive']);
    });

    it('redeploys only running labs', () => {
      expect(allowed(lab => store.canRedeploy(lab))).toEqual(['running']);
    });

    it('destroys running and deploying labs', () => {
      expect(allowed(lab => store.canDestroy(lab))).toEqual([
        'deploying',
        'running',
      ]);
    });

    it('edits only labs without an instance', () => {
      expect(allowed(lab => store.canEdit(lab))).toEqual(['inactive']);
    });

    it('deletes labs without an instance or with a failed one', () => {
      expect(allowed(lab => store.canDelete(lab))).toEqual([
        'inactive',
        'failed',
      ]);
    });
  });

  describe('filters', () => {
    it('toggles a state in the filter', () => {
      store.toggleState(InstanceState.Running);
      expect(store.stateFilter).not.toContain(InstanceState.Running);

      store.toggleState(InstanceState.Running);
      expect(store.stateFilter).toContain(InstanceState.Running);
    });

    it('toggles a collection in the filter', () => {
      store.toggleCollection('c1');
      store.toggleCollection('c2');
      expect(store.collectionFilter).toEqual(['c1', 'c2']);

      store.toggleCollection('c1');
      expect(store.collectionFilter).toEqual(['c2']);
    });

    it('sets the paging, the search and the dates', () => {
      store.setLimit(10);
      store.setOffset(20);
      store.setSearchQuery('core');
      store.setDates('2026-01-01', '2026-02-01');

      expect([store.limit, store.offset, store.searchQuery]).toEqual([
        10,
        20,
        'core',
      ]);
      expect([store.startDate, store.endDate]).toEqual([
        '2026-01-01',
        '2026-02-01',
      ]);
    });
  });

  describe('runtime commands', () => {
    it('reports an error if a command is sent before the store is initialised', async () => {
      await fetchLabs(labOut('lab'));
      const result = await store.deployLab(lab('lab'));

      expect(result.isErr()).toBe(true);
      expect(vi.mocked(statusMessageStore.error).mock.calls[0][1]).toBe(
        'Failed to deploy lab',
      );
    });

    it('sends the commands of a lab and its nodes', async () => {
      store.init(false);
      await fetchLabs(labOut('lab'));

      await store.deployLab(lab('lab'));
      await store.destroyLab(lab('lab'));
      await store.startNode(lab('lab'), 'r1');
      await store.stopNode(lab('lab'), 'r1');
      await store.restartNode(lab('lab'), 'r1');

      expect(dataBinder.emitted).toEqual([
        {labId: 'lab', command: RuntimeCommand.DeployLab},
        {labId: 'lab', command: RuntimeCommand.DestroyLab},
        {labId: 'lab', command: RuntimeCommand.StartNode, node: 'r1'},
        {labId: 'lab', command: RuntimeCommand.StopNode, node: 'r1'},
        {labId: 'lab', command: RuntimeCommand.RestartNode, node: 'r1'},
      ]);
      expect(statusMessageStore.error).not.toHaveBeenCalled();
    });

    it('shows the error of a failed command', async () => {
      store.init(false);
      await fetchLabs(labOut('lab'));
      dataBinder.ack = {code: 500, message: 'Node not found'};

      const result = await store.stopNode(lab('lab'), 'r9');

      expect(result.isErr()).toBe(true);
      expect(statusMessageStore.error).toHaveBeenCalledWith(
        'Node not found',
        'Failed to stop node',
      );
    });

    it('ignores that another operation on the lab is in progress', async () => {
      store.init(false);
      await fetchLabs(labOut('lab'));
      dataBinder.ack = {
        code: ErrorCodes.ErrorLabOperationInProgress,
        message: 'In progress',
      };

      const result = await store.deployLab(lab('lab'));

      expect(result.isOk()).toBe(true);
      expect(statusMessageStore.error).not.toHaveBeenCalled();
    });
  });

  describe('updates', () => {
    it('refetches only the lab that was updated', async () => {
      store.init(false);
      await fetchLabs(labOut('a'), labOut('b'));
      dataBinder.requests = [];
      dataBinder.labs = [
        labOut('a', {instance: instance(InstanceState.Running)}),
        labOut('b'),
      ];

      dataBinder.callbacks.get('lab-updates')!({payload: {labId: 'a'}});

      await vi.waitFor(() =>
        expect(lab('a').state).toBe(InstanceState.Running),
      );
      expect(dataBinder.requests).toEqual(['/labs/a']);
      expect(store.data.map(lab => lab.id)).toEqual(['a', 'b']);
    });

    it('refetches the collections and all labs if a new lab appears', async () => {
      store.init(false);
      await fetchLabs(labOut('a'));
      dataBinder.requests = [];

      dataBinder.callbacks.get('lab-updates')!({payload: {labId: 'new'}});

      await vi.waitFor(() => expect(dataBinder.requests).toEqual(['/labs']));
      expect(collectionStore.fetch).toHaveBeenCalled();
    });

    it('stops listening to updates once it is disposed', () => {
      store.init(false);
      store.dispose();

      expect(dataBinder.callbacks.has('lab-updates')).toBe(false);
    });
  });
});
