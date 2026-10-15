import {useEffect, useMemo, useRef, useState} from 'react';

import {action, observable} from 'mobx';

import {useRootStore} from '@sb/lib/stores/root-store';

export enum DialogAction {
  Add,
  Edit,
  Duplicate,
}

export class DialogState<T> {
  @observable accessor state: T | null = null;
  @observable accessor isOpen: boolean = false;

  private readonly _onClose?: () => void;
  private readonly _onOpen?: (state: T | null) => void;

  constructor(
    dialogState: T | null,
    onClose?: () => void,
    onOpen?: (state: T | null) => void,
  ) {
    this.state = dialogState;
    this.isOpen = false;
    this._onOpen = onOpen;
    this._onClose = onClose;

    this.close = this.close.bind(this);
  }

  @action
  public close() {
    this.isOpen = false;
    if (this._onClose) this._onClose();
  }

  @action
  public openWith(state: T | null = null) {
    this.state = state;
    this.isOpen = true;
    if (this._onOpen) this._onOpen(state);
  }
}

export function useDialogState<T>(
  defaultState: T | null = null,
  onClose?: () => void,
  onOpen?: (state: T | null) => void,
) {
  const [dialogState] = useState(
    () => new DialogState<T>(defaultState, onClose, onOpen),
  );
  return dialogState;
}

/**
 * Returns functions that call the latest of the given functions. The returned
 * functions keep their identity across renders, so memoized children that get
 * them as props don't render again whenever the parent does.
 */
export function useStableCallbacks<
  T extends Record<string, (...args: never[]) => unknown>,
>(callbacks: T): T {
  const latest = useRef(callbacks);
  latest.current = callbacks;

  return useMemo(
    () =>
      Object.fromEntries(
        Object.keys(callbacks).map(key => [
          key,
          (...args: never[]) => latest.current[key](...args),
        ]),
      ) as T,
    [],
  );
}

export function usePromiseWithResolvers() {
  const ref = useRef<PromiseWithResolvers<void> | null>(null);
  if (ref.current === null) {
    ref.current = Promise.withResolvers();
  }
  return ref.current;
}

export const useScopedLabStore = () => {
  const root = useRootStore();
  const [store] = useState(() => root.createLabStore());

  useEffect(() => {
    store.init(false);
    return () => store.dispose();
  }, [store]);

  return store;
};
