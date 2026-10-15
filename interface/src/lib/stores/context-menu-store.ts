import {SyntheticEvent} from 'react';

import {action, observable} from 'mobx';

import {MenuItem} from 'primereact/menuitem';

export interface ContextMenuRequest {
  // The component that opened the menu
  owner: symbol;

  model: MenuItem[];
  event: SyntheticEvent;
  onHide?: () => void;
}

/**
 * The context menu of the app. There is only one, so opening a menu closes the
 * menu that is open.
 */
export class ContextMenuStore {
  @observable.ref accessor request: ContextMenuRequest | null = null;
  @observable accessor isOpen: boolean = false;

  @action
  public open(request: ContextMenuRequest) {
    if (this.isOpen && this.request?.owner !== request.owner) {
      this.request?.onHide?.();
    }

    this.request = request;
    this.isOpen = true;
  }

  /**
   * Closes the menu, or only the menu of the given owner if one is given.
   */
  @action
  public close(owner?: symbol) {
    if (!this.isOpen || (owner && this.request?.owner !== owner)) return;

    this.isOpen = false;
    this.request?.onHide?.();
  }
}
