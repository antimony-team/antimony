import {action, observable} from 'mobx';
import {useState} from 'react';

export enum DialogAction {
  Add,
  Edit,
  Duplicate,
}

export class DialogState<T> {
  @observable accessor state: T | null = null;
  @observable accessor isOpen: boolean = false;

  private readonly _onClose?: () => void;

  constructor(
    public dialogState: T | null,
    onClose?: () => void
  ) {
    this.state = dialogState;
    this.isOpen = false;
    this._onClose = onClose;

    this.close = this.close.bind(this);
  }

  @action
  public close() {
    this.isOpen = false;
    if (this._onClose) this._onClose();
  }

  @action
  public openWith(state: T | null) {
    this.state = state;
    this.isOpen = true;
  }
}

export function useDialogState<T>(
  defaultState: T | null,
  onClose?: () => void
) {
  const [dialogState] = useState(
    () => new DialogState<T>(defaultState, onClose)
  );
  return dialogState;
}
