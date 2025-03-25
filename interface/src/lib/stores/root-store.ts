import {createContext, useContext} from 'react';

import {computed} from 'mobx';

import {LabStore} from '@sb/lib/stores/lab-store';
import {CollectionStore} from '@sb/lib/stores/collection-store';
import {combinedFetchState} from '@sb/lib/utils/utils';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {DataBinder} from '@sb/lib/stores/data-binder/data-binder';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';

export class RootStore {
  _dataBinder: DataBinder;
  _topologyStore: TopologyStore;
  _labStore: LabStore;
  _calendarLabStore: LabStore;
  _deviceStore: DeviceStore;
  _collectionStore: CollectionStore;
  _schemaStore: SchemaStore;
  _statusMessagesStore: StatusMessageStore;

  constructor() {
    this._dataBinder = new DataBinder();

    this._schemaStore = new SchemaStore(this);
    this._deviceStore = new DeviceStore(this);
    this._topologyStore = new TopologyStore(this);
    this._labStore = new LabStore(this);
    this._calendarLabStore = new LabStore(this);
    this._collectionStore = new CollectionStore(this);
    this._statusMessagesStore = new StatusMessageStore(this);
  }

  @computed
  public get fetchState() {
    return combinedFetchState(
      this._topologyStore.fetchReport.state,
      this._labStore.fetchReport.state,
      this._deviceStore.fetchReport.state,
      this._collectionStore.fetchReport.state,
      this._schemaStore.fetchReport.state
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

export const useTopologyStore = () => {
  return useContext(RootStoreContext)._topologyStore;
};

export const useLabStore = () => {
  return useContext(RootStoreContext)._labStore;
};

export const useCalendarLabStore = () => {
  return useContext(RootStoreContext)._calendarLabStore;
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
