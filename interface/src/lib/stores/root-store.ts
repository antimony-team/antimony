import {ShellStore} from '@sb/lib/stores/shell-store';
import {createContext, useContext} from 'react';

import {autorun, computed, observable, runInAction} from 'mobx';

import {AppPhase, FetchState} from '@sb/types/types';
import {LabStore} from '@sb/lib/stores/lab-store';
import {CollectionStore} from '@sb/lib/stores/collection-store';
import {combinedFetchState} from '@sb/lib/utils/utils';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {DataBinder} from '@sb/lib/stores/data-binder/data-binder';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {ServerConfigStore} from '@sb/lib/stores/server-config-store';

export class RootStore {
  _dataBinder: DataBinder;
  _serverConfigStore: ServerConfigStore;
  _topologyStore: TopologyStore;
  _labStore: LabStore;
  _deviceStore: DeviceStore;
  _collectionStore: CollectionStore;
  _schemaStore: SchemaStore;
  _statusMessagesStore: StatusMessageStore;
  _shellStore: ShellStore;

  /**
   * Latch that stays set once the initial fetch of every store has completed.
   *
   * Without it, any background re-fetch would briefly push `fetchState` back to
   * `Pending` and drop the user onto the loading screen again. It is reset on
   * logout so the next user gets a clean load.
   */
  @observable accessor hasLoadedOnce = false;

  /**
   * Poor man's dependency injection ( ͡° ͜ʖ ͡°)
   */
  constructor() {
    this._dataBinder = new DataBinder();

    this._statusMessagesStore = new StatusMessageStore(this);

    this._serverConfigStore = new ServerConfigStore(this);

    this._schemaStore = new SchemaStore(this);
    this._deviceStore = new DeviceStore(this);
    this._collectionStore = new CollectionStore(this);
    this._topologyStore = new TopologyStore(
      this,
      this._dataBinder,
      this._schemaStore,
      this._deviceStore,
      [this._schemaStore],
    );

    this._labStore = new LabStore(
      this,
      this._dataBinder,
      this._topologyStore,
      this._statusMessagesStore,
      [this._schemaStore],
    );
    this._labStore.init(true);

    this._shellStore = new ShellStore(
      this._dataBinder,
      this._statusMessagesStore,
    );

    autorun(() => {
      if (!this._dataBinder.isLoggedIn) {
        runInAction(() => (this.hasLoadedOnce = false));
      } else if (this.fetchState === FetchState.Done) {
        runInAction(() => (this.hasLoadedOnce = true));
      }
    });
  }

  /**
   * The single source of truth for which top-level screen is shown.
   *
   * Note that a connection error while the user is logged in does not produce
   * a phase of its own. The app stays mounted in that case and only the
   * connection banner is shown, see `DataBinder.hasDegradedConnection`.
   */
  @computed
  public get phase(): AppPhase {
    console.log('PHASE:', this._dataBinder.isLoggedIn);

    if (!this._dataBinder.isLoggedIn) {
      if (this._dataBinder.hasConnectionError) return AppPhase.Offline;

      return this._dataBinder.isReady
        ? AppPhase.Unauthenticated
        : AppPhase.Connecting;
    }

    console.log('HAS LOADED ONCE:', this.hasLoadedOnce);

    return this.hasLoadedOnce ? AppPhase.Ready : AppPhase.Loading;
  }

  @computed
  public get fetchState() {
    return combinedFetchState(
      this._topologyStore.fetchReport.state,
      this._serverConfigStore.fetchReport.state,
      this._labStore.fetchReport.state,
      this._deviceStore.fetchReport.state,
      this._collectionStore.fetchReport.state,
      this._schemaStore.fetchReport.state,
    );
  }

  public createLabStore(): LabStore {
    return new LabStore(
      this,
      this._dataBinder,
      this._topologyStore,
      this._statusMessagesStore,
    );
  }
}

export const rootStore = new RootStore();
export const RootStoreContext = createContext(rootStore);

export const useRootStore = () => {
  return useContext(RootStoreContext);
};

export const useDataBinder = () => {
  return useContext(RootStoreContext)._dataBinder;
};

export const useAuthUser = () => {
  return useContext(RootStoreContext)._dataBinder.authUser;
};

export const useServerConfig = () => {
  return useContext(RootStoreContext)._serverConfigStore.config;
};

export const useTopologyStore = () => {
  return useContext(RootStoreContext)._topologyStore;
};

export const useLabStore = () => {
  return useContext(RootStoreContext)._labStore;
};

export const useDeviceStore = () => {
  return useContext(RootStoreContext)._deviceStore;
};

export const useCollectionStore = () => {
  return useContext(RootStoreContext)._collectionStore;
};

export const useSchemaStore = () => {
  return useContext(RootStoreContext)._schemaStore;
};

export const useStatusMessages = () => {
  return useContext(RootStoreContext)._statusMessagesStore;
};

export const useShellStore = () => {
  return useContext(RootStoreContext)._shellStore;
};
