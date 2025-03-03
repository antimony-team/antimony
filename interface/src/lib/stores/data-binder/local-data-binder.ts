import {computed, observable} from 'mobx';

import {uuid4} from '@sb/types/types';
import {generateUuidv4} from '@sb/lib/utils/utils';
import devices from '@sb/../local-data/devices.json';
import {DataBinder, DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {Result} from '@sb/types/result';
import {TopologyIn, TopologyOut} from '@sb/types/domain/topology';
import {Collection, CollectionIn} from '@sb/types/domain/collection';
import {Lab} from '@sb/types/domain/lab';
import {DeviceInfo} from '@sb/types/domain/device-info';
import {StatusMessage} from '@sb/types/domain/status-message';

export class LocalDataBinder extends DataBinder {
  @observable accessor isLoggedIn = true;
  @observable accessor hasExternalError = false;

  protected async fetch<R, T>(
    path: string,
    method: string,
    body?: R,
    isExternal = false
  ): Promise<Result<DataResponse<T>>> {
    if (isExternal) {
      return this.fetchExternal(path, method, body);
    }

    const parts = path.split(/[/?&]/);
    switch (parts[1]) {
      case 'topologies':
        return this.handleTopologies(
          method,
          parts[2],
          body as TopologyIn
        ) as Result<DataResponse<T>>;
      case 'collections':
        return this.handleCollections(
          method,
          parts[2],
          body as CollectionIn
        ) as Result<DataResponse<T>>;
      case 'devices':
        return this.handleDevices(method) as Result<DataResponse<T>>;
      case 'labs':
        return this.handleLabs(method) as Result<DataResponse<T>>;
      case 'status-messages':
        return this.handleStatusMessages(method) as Result<DataResponse<T>>;
    }

    return Result.createErr({
      code: '-1',
      message: `Unsupported resource URI '${path}'`,
    });
  }

  private handleTopologies(
    method: string,
    id?: uuid4,
    body?: TopologyIn
  ): Result<DataResponse<TopologyOut[] | string | null>> {
    switch (method) {
      case 'GET':
        return Result.createOk({
          payload: safeParseJsonLocalStorage(
            'topologies',
            '[]'
          ) as TopologyOut[],
        });
      case 'DELETE':
        return this.deleteTopology(id!);
      case 'PATCH':
        return this.patchTopology(id!, body!);
      case 'POST':
        return this.postTopology(body!);
    }

    return Result.createErr({code: -1, message: 'Unsupported method'});
  }

  private deleteTopology(id: uuid4): Result<DataResponse<null>> {
    const topologies = safeParseJsonLocalStorage(
      'topologies',
      '[]'
    ) as TopologyOut[];
    const topology = topologies.find(topology => topology.id === id);
    const topologyIndex = topology ? topologies.indexOf(topology) : -1;

    if (topologyIndex === -1) {
      return Result.createErr({code: -1, message: 'Topology ID not found'});
    }

    topologies.splice(topologyIndex, 1);
    window.localStorage.setItem('topologies', JSON.stringify(topologies));

    return Result.createOk({payload: null});
  }

  private patchTopology(
    id: uuid4,
    updatedTopology: TopologyIn
  ): Result<DataResponse<null>> {
    const topologies = safeParseJsonLocalStorage(
      'topologies',
      '[]'
    ) as TopologyOut[];
    const topology = topologies.find(topology => topology.id === id);
    const topologyIndex = topology ? topologies.indexOf(topology) : -1;

    if (topologyIndex === -1) {
      return Result.createErr({code: -1, message: 'Topology ID not found'});
    }

    topologies[topologyIndex] = {
      ...topologies[topologyIndex],
      ...updatedTopology,
    };
    window.localStorage.setItem('topologies', JSON.stringify(topologies));

    return Result.createOk({payload: null});
  }

  private postTopology(topology: TopologyIn): Result<DataResponse<string>> {
    const topologies = safeParseJsonLocalStorage(
      'topologies',
      '[]'
    ) as TopologyOut[];
    const topologyId = generateUuidv4();

    const collections = safeParseJsonLocalStorage(
      'collections',
      '[]'
    ) as Collection[];
    const targetCollection = collections.find(
      collection => collection.id === topology.collectionId
    );
    if (!targetCollection) {
      return Result.createErr({code: -1, message: 'Invalid Collection ID'});
    }

    topologies.push({
      id: topologyId,
      creatorId: '-1',
      collectionId: targetCollection.id,
      definition: topology.definition,
    });
    window.localStorage.setItem('topologies', JSON.stringify(topologies));

    return Result.createOk({payload: topologyId});
  }

  private handleCollections(
    method: string,
    id?: uuid4,
    body?: CollectionIn
  ): Result<DataResponse<Collection[] | null>> {
    switch (method) {
      case 'GET':
        return Result.createOk({
          payload: safeParseJsonLocalStorage(
            'collections',
            '[]'
          ) as Collection[],
        });
      case 'DELETE':
        return this.deleteCollection(id!);
      case 'PATCH':
        return this.patchCollection(id!, body!);
      case 'POST':
        return this.postCollection(body!);
    }

    return Result.createErr({code: '-1', message: 'Unsupported method'});
  }

  private deleteCollection(id: uuid4): Result<DataResponse<null>> {
    const collections = safeParseJsonLocalStorage(
      'collections',
      '[]'
    ) as Collection[];
    const collection = collections.find(collection => collection.id === id);
    const collectionIndex = collection ? collections.indexOf(collection) : -1;

    if (collectionIndex === -1) {
      return Result.createErr({code: -1, message: 'Collection ID not found'});
    }

    collections.splice(collectionIndex, 1);
    window.localStorage.setItem('collections', JSON.stringify(collections));

    return Result.createOk({payload: null});
  }

  private patchCollection(
    id: uuid4,
    updatedCollection: CollectionIn
  ): Result<DataResponse<null>> {
    const collections = safeParseJsonLocalStorage(
      'collections',
      '[]'
    ) as Collection[];
    const collection = collections.find(collection => collection.id === id);
    const collectionIndex = collection ? collections.indexOf(collection) : -1;

    if (collectionIndex === -1) {
      return Result.createErr({code: '-1', message: 'Collection ID not found'});
    }

    collections[collectionIndex] = {
      ...collections[collectionIndex],
      ...updatedCollection,
    };
    window.localStorage.setItem('collections', JSON.stringify(collections));

    return Result.createOk({payload: null});
  }

  private postCollection(collection: CollectionIn): Result<DataResponse<null>> {
    const collections = safeParseJsonLocalStorage(
      'collections',
      '[]'
    ) as Collection[];

    collections.push({
      id: generateUuidv4(),
      name: collection.name,
      publicWrite: collection.publicWrite,
      publicDeploy: collection.publicDeploy,
    });
    window.localStorage.setItem('collections', JSON.stringify(collections));

    return Result.createOk({payload: null});
  }

  private handleDevices(method: string): Result<DataResponse<DeviceInfo[]>> {
    switch (method) {
      case 'GET':
        return Result.createOk({payload: devices as DeviceInfo[]});
    }

    return Result.createErr({code: '-1', message: 'Unsupported method'});
  }

  private handleLabs(method: string): Result<DataResponse<Lab[]>> {
    switch (method) {
      case 'GET':
        return Result.createOk({payload: []});
    }

    return Result.createErr({code: '-1', message: 'Unsupported method'});
  }

  private handleStatusMessages(
    method: string
  ): Result<DataResponse<StatusMessage[]>> {
    switch (method) {
      case 'GET':
        return Result.createOk({payload: []});
    }

    return Result.createErr({code: '-1', message: 'Unsupported method'});
  }

  public async login(): Promise<boolean> {
    return true;
  }
  public logout() {}

  @computed
  public get hasConnectionError() {
    return this.hasExternalError;
  }
}

function safeParseJsonLocalStorage(key: string, defaultValue: string) {
  if (!window.localStorage.getItem(key)) {
    window.localStorage.setItem(key, defaultValue);
    return JSON.parse(defaultValue);
  }

  const value = window.localStorage.getItem(key);

  try {
    return JSON.parse(value!);
  } catch (e) {
    console.warn(
      `[COOKIES] Failed to parse JSON from cookie '${key}'. Resetting to default value. Original value: ${value}`
    );
    window.localStorage.setItem(key, defaultValue);
    return JSON.parse(defaultValue);
  }
}
