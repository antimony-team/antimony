import {describe, expect, it} from 'vitest';

import {RootStore} from '@sb/lib/stores/root-store';
import {ServerConfigStore} from '@sb/lib/stores/server-config-store';
import {ServerConfig} from '@sb/types/domain/server-config';
import {Result} from '@sb/types/result';

const CONFIG: ServerConfig = {
  ssh: {enabled: true, port: 2222},
  capture: {enabled: false, excludedInterfaces: ['lo']},
  deployment: {provider: 'containerlab'},
};

describe('ServerConfigStore', () => {
  it('holds the single config of the server', async () => {
    const dataBinder = {
      isLoggedIn: false,
      get: async () => Result.createOk({payload: CONFIG}),
    };
    const store = new ServerConfigStore({
      _dataBinder: dataBinder,
    } as unknown as RootStore);
    expect(store.config).toBeUndefined();

    dataBinder.isLoggedIn = true;
    await store.fetch();

    expect(store.config).toEqual(CONFIG);
    expect(store.data).toHaveLength(1);
    store.dispose();
  });
});
