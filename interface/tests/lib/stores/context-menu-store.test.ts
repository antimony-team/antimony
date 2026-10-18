import {SyntheticEvent} from 'react';

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  ContextMenuRequest,
  ContextMenuStore,
} from '@sb/lib/stores/context-menu-store';

function request(owner: symbol): ContextMenuRequest {
  return {owner, model: [], event: {} as SyntheticEvent, onHide: vi.fn()};
}

describe('ContextMenuStore', () => {
  let store: ContextMenuStore;
  const graph = Symbol('graph');
  const list = Symbol('list');

  beforeEach(() => {
    store = new ContextMenuStore();
  });

  it('opens the menu of a request', () => {
    const graphMenu = request(graph);
    store.open(graphMenu);

    expect(store.isOpen).toBe(true);
    expect(store.request).toBe(graphMenu);
  });

  it('hides the open menu when another owner opens one', () => {
    const graphMenu = request(graph);
    store.open(graphMenu);
    store.open(request(list));

    expect(graphMenu.onHide).toHaveBeenCalledOnce();
    expect(store.request?.owner).toBe(list);
  });

  it('keeps the open menu when the same owner opens it again', () => {
    const graphMenu = request(graph);
    store.open(graphMenu);
    store.open(request(graph));

    expect(graphMenu.onHide).not.toHaveBeenCalled();
  });

  it('closes the open menu', () => {
    const graphMenu = request(graph);
    store.open(graphMenu);
    store.close();

    expect(store.isOpen).toBe(false);
    expect(graphMenu.onHide).toHaveBeenCalledOnce();
  });

  it('closes the menu only for its own owner', () => {
    const graphMenu = request(graph);
    store.open(graphMenu);
    store.close(list);
    expect(store.isOpen).toBe(true);

    store.close(graph);
    expect(store.isOpen).toBe(false);
  });

  it('hides a menu only once when it is closed twice', () => {
    const graphMenu = request(graph);
    store.open(graphMenu);
    store.close();
    store.close();

    expect(graphMenu.onHide).toHaveBeenCalledOnce();
  });

  it('does nothing when no menu is open', () => {
    expect(() => store.close()).not.toThrow();
    expect(store.isOpen).toBe(false);
  });
});
