import {QueryBuilder} from '@sb/lib/utils/query-builder';
import {action, computed, observable, observe} from 'mobx';

import {DataStore} from '@sb/lib/stores/data-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {InstanceState, Lab, LabIn} from '@sb/types/domain/lab';

export class LabStore extends DataStore<Lab, LabIn, Lab> {
  @observable accessor offset: number = 0;
  @observable accessor totalEntries: number | null = 0;

  @observable accessor limit: number = 1000;
  @observable accessor stateFilter: InstanceState[] = [
    InstanceState.Deploying,
    InstanceState.Running,
  ];
  @observable accessor collectionFilter: string[] = [];
  @observable accessor searchQuery: string = '';

  @observable accessor startDate: string | null = null;
  @observable accessor endDate: string | null = null;

  constructor(rootStore: RootStore) {
    super(rootStore);

    observe(this, 'getParams' as keyof this, () => this.fetch());

    this.rootStore._dataBinder.subscribeNamespace('lab-updates', () =>
      this.fetch()
    );
  }

  protected get resourcePath(): string {
    return '/labs';
  }

  @computed
  protected get getParams() {
    return new QueryBuilder()
      .add('limit', this.limit)
      .add('offset', this.offset)
      .add('searchQuery', this.searchQuery)
      .addList('stateFilter', this.stateFilter)
      .addList('collectionFilter', this.collectionFilter)
      .add('startDate', this.startDate)
      .add('endDate', this.endDate)
      .toString();
  }

  @action
  protected handleUpdate(response: DataResponse<Lab[]>): void {
    this.data = response.payload;
    this.lookup = new Map(this.data.map(lab => [lab.id, lab]));

    if (response.headers && response.headers.has('X-Total-Count')) {
      this.totalEntries = Number(response.headers!.get('X-Total-Count'));
    }
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
  public setStateFilter(filter: InstanceState[]) {
    this.stateFilter = filter;
  }

  @action
  public setCollectionFilter(filter: string[]) {
    this.collectionFilter = filter;
  }

  public toggleState(state: InstanceState) {
    if (this.stateFilter.includes(state)) {
      this.setStateFilter(this.stateFilter.filter(s => s !== state));
    } else {
      this.setStateFilter([...this.stateFilter, state]);
    }
  }

  public toggleCollection(collectionId: string) {
    if (this.collectionFilter.includes(collectionId)) {
      this.setCollectionFilter(
        this.collectionFilter.filter(c => c !== collectionId)
      );
    } else {
      this.setCollectionFilter([...this.collectionFilter, collectionId]);
    }
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
}
