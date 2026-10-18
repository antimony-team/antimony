import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DeviceStore} from '@sb/lib/stores/device-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {DeviceInfo} from '@sb/types/domain/device-info';
import {Result} from '@sb/types/result';

const SRLINUX: DeviceInfo = {
  kind: 'nokia_srlinux',
  kindAliases: ['srl'],
  name: 'Nokia SR Linux',
  images: [],
  type: 'router',
  interfaces: [{pattern: 'e1-$', start: 1}],
};

describe('DeviceStore', () => {
  let store: DeviceStore;
  let images: {src: string}[];

  beforeEach(async () => {
    images = [];
    vi.stubGlobal(
      'Image',
      class {
        public src = '';
        public crossOrigin = '';

        constructor() {
          images.push(this);
        }
      },
    );

    const dataBinder = {
      isLoggedIn: true,
      get: async () => Result.createOk({payload: [SRLINUX]}),
    };
    store = new DeviceStore({_dataBinder: dataBinder} as unknown as RootStore);
    await store.fetch();
  });

  afterEach(() => {
    store.dispose();
    vi.unstubAllGlobals();
  });

  it('returns the interfaces of a device by its kind and its aliases', () => {
    expect(store.getInterfaceConfig('nokia_srlinux')).toEqual(SRLINUX);
    expect(store.getInterfaceConfig('srl')).toEqual(SRLINUX);
  });

  it('names the interfaces of unknown devices eth1, eth2 and so on', () => {
    const fallback = {interfaces: [{pattern: 'eth$', start: 1}]};

    expect(store.getInterfaceConfig('unknown')).toEqual(fallback);
    expect(store.getInterfaceConfig(undefined)).toEqual(fallback);
  });

  it('returns the icon of a node and falls back to the client icon', () => {
    expect(store.getNodeIcon('pe')).toBe('./icons/nodes/router.svg');
    expect(store.getNodeIcon('leaf')).toBe('./icons/nodes/switch.svg');
    expect(store.getNodeIcon('unknown')).toBe('./icons/nodes/client.svg');
    expect(store.getNodeIcon()).toBe('./icons/nodes/client.svg');
  });

  it('preloads each icon only once', () => {
    store.getNodeIcon('router');
    store.getNodeIcon('pe');
    store.getNodeIcon('server');

    expect(images.map(image => image.src)).toEqual([
      './icons/nodes/router.svg',
      './icons/nodes/server.svg',
    ]);
  });

  it('draws routers and switches as ellipses and everything else as octagons', () => {
    expect(store.getNodeShape('router')).toBe('ellipse');
    expect(store.getNodeShape('spine')).toBe('ellipse');
    expect(store.getNodeShape('server')).toBe('octagon');
    expect(store.getNodeShape('unknown')).toBe('octagon');
    expect(store.getNodeShape()).toBe('octagon');
  });

  it('lists each icon once', () => {
    const icons = store.getAllIcons().map(([icon]) => icon);

    expect(icons).toEqual([...new Set(icons)]);
    expect(icons).toContain('router');
  });
});
