import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

import {DataStore} from '@sb/lib/stores/data-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {QueryBuilder} from '@sb/lib/utils/query-builder';
import {InstanceState, Lab, LabIn, LabOut} from '@sb/types/domain/lab';
import dayjs from 'dayjs';
import {action, computed, observable, observe, toJS} from 'mobx';

export class LabStore extends DataStore<Lab, LabIn, LabOut> {
  @observable accessor offset: number = 0;
  @observable accessor totalEntries: number | null = 0;

  @observable accessor limit: number = 1000;
  @observable accessor stateFilter: InstanceState[] = [
    InstanceState.Scheduled,
    InstanceState.Deploying,
    InstanceState.Running,
    InstanceState.Inactive,
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

  public deployLab(lab: Lab) {}

  public destroyLab(lab: Lab) {}

  @action
  protected handleUpdate(response: DataResponse<LabOut[]>): void {
    this.data = this.parseLabs(response.payload);
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
    console.log('toggling state: ', state);

    if (this.stateFilter.includes(state)) {
      this.setStateFilter(this.stateFilter.filter(s => s !== state));
    } else {
      this.setStateFilter([...this.stateFilter, state]);
    }
    console.log('filter: ', toJS(this.stateFilter));
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

  private parseLabs(input: LabOut[]): Lab[] {
    return input.map(lab => {
      const startTime = new Date(lab.startTime);
      const endTime = new Date(lab.endTime);

      return {
        ...lab,
        startTime: startTime,
        endTime: endTime,
        state: lab.instance
          ? lab.instance.state
          : startTime >= dayjs(new Date()).add(2, 'minute').toDate()
            ? InstanceState.Scheduled
            : InstanceState.Inactive,
      };
    });
  }
}
