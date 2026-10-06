import {action, observable} from 'mobx';
import {useEffect, useRef, useState} from 'react';
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

const STORAGE_PREFIX = 'antimony:';

/**
 * Like useState, but the value survives reloads via localStorage.
 * Pass isValid to reject stored values that no longer fit, e.g., after a rename.
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  isValid?: (value: unknown) => value is T,
) {
  const storageKey = STORAGE_PREFIX + key;

  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === null) return defaultValue;

      const parsed: unknown = JSON.parse(stored);
      if (isValid && !isValid(parsed)) return defaultValue;

      return parsed as T;
    } catch {
      // Broken JSON or storage blocked (private mode): fall back to the default
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the value still works for this session
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}
