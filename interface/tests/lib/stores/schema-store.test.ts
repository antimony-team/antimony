import {describe, expect, it} from 'vitest';

import {RootStore} from '@sb/lib/stores/root-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {Result} from '@sb/types/result';
import {FetchState} from '@sb/types/types';

const CLAB_SCHEMA = {
  $id: 'clab',
  type: 'object',
  required: ['name'],
  definitions: {'node-config': {properties: {}}},
  markdownDescription: 'Not part of the JSON schema specification',
};

const ANNOTATIONS_SCHEMA = {
  $id: 'annotations',
  type: 'object',
  properties: {nodeAnnotations: {type: 'array'}},
};

function createStore(fails = false) {
  const requests: string[] = [];
  const dataBinder = {
    isLoggedIn: false,
    get: async (path: string) => {
      requests.push(path);
      if (fails) return Result.createErr({code: 500, message: 'Failed'});

      return Result.createOk({
        payload: path.endsWith('/annotations')
          ? ANNOTATIONS_SCHEMA
          : CLAB_SCHEMA,
      });
    },
  };

  const store = new SchemaStore({
    _dataBinder: dataBinder,
  } as unknown as RootStore);
  store.dispose();
  dataBinder.isLoggedIn = true;

  return {store, requests};
}

describe('SchemaStore', () => {
  it('fetches the annotations schema before the containerlab schema', async () => {
    const {store, requests} = createStore();
    await store.fetch();

    expect(requests).toEqual(['/clab-schema/annotations', '/clab-schema']);
    expect(store.fetchReport.state).toBe(FetchState.Done);
    expect(store.clabSchema).toEqual(CLAB_SCHEMA);
    expect(store.annotationsSchema).toEqual(ANNOTATIONS_SCHEMA);
  });

  it('compiles validators for both schemas', async () => {
    const {store} = createStore();
    await store.fetch();

    expect(store.clabValidator!({name: 'lab'})).toBe(true);
    expect(store.clabValidator!({})).toBe(false);
    expect(store.annotationsValidator!({nodeAnnotations: []})).toBe(true);
    expect(store.annotationsValidator!({nodeAnnotations: {}})).toBe(false);
  });

  it('compiles the schemas again when they are fetched another time', async () => {
    const {store} = createStore();
    await store.fetch();
    const validator = store.clabValidator;
    await store.fetch();

    expect(store.clabValidator).not.toBe(validator);
  });

  it('has no validators if fetching fails', async () => {
    const {store} = createStore(true);
    await store.fetch();

    expect(store.fetchReport.state).toBe(FetchState.Error);
    expect(store.clabValidator).toBeNull();
    expect(store.annotationsValidator).toBeNull();
  });
});
