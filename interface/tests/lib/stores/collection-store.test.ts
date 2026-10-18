import {makeObservable, observable, runInAction} from 'mobx';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {CollectionStore} from '@sb/lib/stores/collection-store';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {RootStore} from '@sb/lib/stores/root-store';
import {Collection} from '@sb/types/domain/collection';
import {EMPTY_AUTH_USER} from '@sb/types/domain/user';
import {Result} from '@sb/types/result';
import {FetchState} from '@sb/types/types';

class FakeDataBinder {
  public isLoggedIn = false;
  public authUser = EMPTY_AUTH_USER;
  public collections: Collection[] = [];
  public fails = false;
  public requests: string[] = [];

  constructor() {
    makeObservable(this, {isLoggedIn: observable, authUser: observable});
  }

  public async get(path: string) {
    this.requests.push(`GET ${path}`);
    if (this.fails) {
      return Result.createErr({code: 500, message: 'Server error'});
    }
    return Result.createOk({payload: this.collections});
  }

  public async post(path: string) {
    this.requests.push(`POST ${path}`);
    return this.result();
  }

  public async patch(path: string) {
    this.requests.push(`PATCH ${path}`);
    return this.result();
  }

  public async delete(path: string) {
    this.requests.push(`DELETE ${path}`);
    return this.result();
  }

  private result(): Result<DataResponse<void>> {
    return this.fails
      ? Result.createErr({code: 400, message: 'Bad request'})
      : Result.createOk({payload: undefined});
  }
}

function collection(
  id: string,
  name: string,
  publicWrite = false,
  publicDeploy = false,
): Collection {
  return {id, name, publicWrite, publicDeploy};
}

describe('CollectionStore', () => {
  let dataBinder: FakeDataBinder;
  let labStore: {fetch: () => Promise<void>};
  let topologyStore: {fetch: () => Promise<void>};
  let store: CollectionStore;

  beforeEach(async () => {
    dataBinder = new FakeDataBinder();
    labStore = {fetch: vi.fn(async () => {})};
    topologyStore = {fetch: vi.fn(async () => {})};
    dataBinder.collections = [
      collection('c1', 'zeta', true, false),
      collection('c2', 'alpha', false, true),
      collection('c3', 'Beta'),
    ];

    store = new CollectionStore({
      _dataBinder: dataBinder,
      _labStore: labStore,
      _topologyStore: topologyStore,
    } as unknown as RootStore);
  });

  function logIn(isAdmin = false) {
    runInAction(() => {
      dataBinder.authUser = {id: 'user', name: 'user', isAdmin};
      dataBinder.isLoggedIn = true;
    });
  }

  describe('fetching', () => {
    it('waits for the login before fetching', async () => {
      await store.fetch();

      expect(dataBinder.requests).toEqual([]);
      expect(store.fetchReport.state).toBe(FetchState.Pending);
    });

    it('fetches once the user is logged in', async () => {
      logIn();

      await vi.waitFor(() =>
        expect(store.fetchReport.state).toBe(FetchState.Done),
      );
      expect(dataBinder.requests).toEqual(['GET /collections']);
    });

    it('waits for its dependencies before fetching', async () => {
      const dependency = observable({fetchReport: {state: FetchState.Pending}});
      store.dispose();
      store = new CollectionStore(
        {_dataBinder: dataBinder} as unknown as RootStore,
        [dependency],
      );
      logIn();
      await Promise.resolve();
      expect(dataBinder.requests).toEqual([]);

      runInAction(() => (dependency.fetchReport = {state: FetchState.Done}));
      await vi.waitFor(() =>
        expect(dataBinder.requests).toEqual(['GET /collections']),
      );
    });

    it('sorts the collections by name', async () => {
      logIn();
      await store.fetch();

      expect(store.data.map(c => c.name)).toEqual(['alpha', 'Beta', 'zeta']);
      expect(store.lookup.get('c3')?.name).toBe('Beta');
      expect(store.hasAccessibleCollections).toBe(true);
    });

    it('reports a failed fetch', async () => {
      logIn();
      dataBinder.fails = true;
      await store.fetch();

      expect(store.fetchReport).toEqual({
        state: FetchState.Error,
        errorCode: '500',
        errorMessage: 'Server error',
      });
    });

    it('drops all collections on logout', async () => {
      logIn();
      await store.fetch();
      runInAction(() => (dataBinder.isLoggedIn = false));

      expect(store.data).toEqual([]);
      expect(store.lookup.size).toBe(0);
      expect(store.fetchReport.state).toBe(FetchState.Pending);
      expect(store.hasAccessibleCollections).toBe(false);
    });

    it('stops reacting to the login once it is disposed', async () => {
      store.dispose();
      logIn();
      await Promise.resolve();

      expect(dataBinder.requests).toEqual([]);
    });
  });

  describe('permissions', () => {
    it('lets admins deploy and write in every collection', async () => {
      logIn(true);
      await store.fetch();

      expect(store.canDeployIn('c3')).toBe(true);
      expect(store.canWriteIn('c3')).toBe(true);
      expect(store.canDeployIn('unknown')).toBe(true);
    });

    it('lets users deploy only in collections anyone can deploy in', async () => {
      logIn();
      await store.fetch();

      expect(store.canDeployIn('c1')).toBe(false);
      expect(store.canDeployIn('c2')).toBe(true);
      expect(store.canDeployIn('c3')).toBe(false);
    });

    it('lets users write only in collections anyone can edit', async () => {
      logIn();
      await store.fetch();

      expect(store.canWriteIn('c1')).toBe(true);
      expect(store.canWriteIn('c2')).toBe(false);
      expect(store.canWriteIn('c3')).toBe(false);
    });

    it('lets users do nothing in unknown collections', () => {
      logIn();

      expect(store.canDeployIn('unknown')).toBe(false);
      expect(store.canWriteIn('unknown')).toBe(false);
    });

    it('has deployable collections if the user can deploy in any of them', async () => {
      logIn();
      await store.fetch();
      expect(store.hasDeployableCollections).toBe(true);

      dataBinder.collections = [collection('c1', 'zeta', true, false)];
      await store.fetch();
      expect(store.hasDeployableCollections).toBe(false);
    });
  });

  describe('changes', () => {
    beforeEach(async () => {
      logIn();
      await store.fetch();
      dataBinder.requests = [];
    });

    it('refetches after adding a collection', async () => {
      await store.add({name: 'new', publicWrite: false, publicDeploy: false});

      expect(dataBinder.requests).toEqual([
        'POST /collections',
        'GET /collections',
      ]);
    });

    it('refetches after updating a collection', async () => {
      await store.update('c1', {name: 'renamed'});

      expect(dataBinder.requests).toEqual([
        'PATCH /collections/c1',
        'GET /collections',
      ]);
    });

    it('refetches labs and topologies after deleting a collection', async () => {
      const result = await store.delete('c1');

      expect(result.isOk()).toBe(true);
      expect(labStore.fetch).toHaveBeenCalled();
      expect(topologyStore.fetch).toHaveBeenCalled();
      expect(dataBinder.requests).toEqual([
        'DELETE /collections/c1',
        'GET /collections',
      ]);
    });

    it('does not refetch anything if a change fails', async () => {
      dataBinder.fails = true;
      await store.add({name: 'new', publicWrite: false, publicDeploy: false});
      await store.update('c1', {name: 'renamed'});
      const result = await store.delete('c1');

      expect(result.isErr()).toBe(true);
      expect(labStore.fetch).not.toHaveBeenCalled();
      expect(dataBinder.requests).toEqual([
        'POST /collections',
        'PATCH /collections/c1',
        'DELETE /collections/c1',
      ]);
    });
  });
});
