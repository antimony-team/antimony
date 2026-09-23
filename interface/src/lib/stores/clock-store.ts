import {observable, runInAction} from 'mobx';

export class ClockStore {
  @observable accessor now = Date.now();

  constructor() {
    setInterval(() => runInAction(() => (this.now = Date.now())), 1000);
  }
}
