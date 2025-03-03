import {action, computed, observable, observe} from 'mobx';

import {DataStore} from '@sb/lib/stores/data-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {RemoteDataBinder} from '@sb/lib/stores/data-binder/remote-data-binder';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {Lab, LabIn, LabState, NodeMeta} from '@sb/types/domain/lab';

export class LabStore extends DataStore<Lab, LabIn, Lab> {
  @observable accessor offset: number = 0;
  @observable accessor totalEntries: number | null = 0;

  @observable accessor limit: number = 1000;
  @observable accessor stateFilter: LabState[] = [
    LabState.Deploying,
    LabState.Running,
  ];
  @observable accessor collectionFilter: string[] = [];
  @observable accessor searchQuery: string = '';

  @observable accessor startDate: string | null = null;
  @observable accessor endDate: string | null = null;

  @observable accessor metaLookup: Map<string, Map<string, NodeMeta>> =
    new Map();

  constructor(rootStore: RootStore) {
    super(rootStore);

    observe(this, 'getParams' as keyof this, () => this.fetch());

    if (!process.env.IS_OFFLINE) {
      (this.rootStore._dataBinder as RemoteDataBinder).socket.on(
        'labsUpdate',
        () => this.fetch()
      );
    }
  }

  protected get resourcePath(): string {
    return '/labs';
  }

  @computed
  protected get getParams() {
    return (
      `?limit=${this.limit}` +
      `&offset=${this.offset}` +
      `&stateFilter=${JSON.stringify(this.stateFilter)}` +
      `&searchQuery=${JSON.stringify(this.searchQuery)}` +
      `&collectionFilter=${JSON.stringify(this.collectionFilter)}` +
      `&startDate=${JSON.stringify(this.startDate)}` +
      `&endDate=${JSON.stringify(this.endDate)}`
    );
  }

  @action
  protected handleUpdate(response: DataResponse<Lab[]>): void {
    this.data = response.payload;
    this.lookup = new Map(this.data.map(lab => [lab.id, lab]));

    if (response.headers && response.headers.has('X-Total-Count')) {
      this.totalEntries = Number(response.headers!.get('X-Total-Count'));
    }

    this.metaLookup = new Map(
      this.data.map(lab => [
        lab.id,
        new Map(lab.nodeMeta.map(meta => [meta.name, meta])),
      ])
    );
  }

  @action
  public setLimit(limit: number) {
    this.limit = limit;
  }

  @action
  public setOffset(offset: number) {
    this.offset = offset;
  }

  @action
  public setStateFilter(stateFilter: LabState[]) {
    this.stateFilter = stateFilter;
  }

  @action
  public setGroupFilter(groupFilter: string[]) {
    this.collectionFilter = groupFilter;
  }

  @action
  public setSearchQuery(searchQuery: string) {
    this.searchQuery = searchQuery;
  }

  @action
  public setDates(startDate: string, endDate: string) {
    this.startDate = startDate;
    this.endDate = endDate;
  }

  public toggleStateFilter(state: LabState) {
    if (this.stateFilter.includes(state)) {
      this.setStateFilter(this.stateFilter.filter(s => s !== state));
    } else {
      this.setStateFilter([...this.stateFilter, state]);
    }
  }

  public toggleGroupFilter(group: string) {
    if (this.collectionFilter.includes(group)) {
      this.setGroupFilter(this.collectionFilter.filter(g => g !== group));
    } else {
      this.setGroupFilter([...this.collectionFilter, group]);
    }
  }
}
