import {
  DataResponse,
  Subscription,
} from '@sb/lib/stores/data-binder/data-binder';

import {DataStore} from '@sb/lib/stores/data-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {QueryBuilder} from '@sb/lib/utils/query-builder';
import {
  Instance,
  InstanceOut,
  InstanceState,
  Lab,
  LabCommand,
  LabCommandData,
  LabIn,
  LabOut,
} from '@sb/types/domain/lab';
import {Result} from '@sb/types/result';
import dayjs from 'dayjs';
import {action, computed, observable, observe} from 'mobx';

export class LabStore extends DataStore<Lab, LabIn, LabOut> {
  @observable accessor offset: number = 0;
  @observable accessor totalEntries: number | null = 0;

  @observable accessor limit: number = 1000;
  @observable accessor stateFilter: InstanceState[] = [
    InstanceState.Scheduled,
    InstanceState.Deploying,
    InstanceState.Running,
    InstanceState.Failed,
    InstanceState.Inactive,
    InstanceState.Stopping,
  ];
  @observable accessor collectionFilter: string[] = [];
  @observable accessor searchQuery: string = '';

  @observable accessor startDate: string | null = null;
  @observable accessor endDate: string | null = null;

  private labCommandsSubscription: Subscription;

  constructor(rootStore: RootStore) {
    super(rootStore);

    observe(this, 'getParams' as keyof this, () => this.fetch());

    this.rootStore._dataBinder.subscribeNamespace(
      'lab-updates',
      this.onLabUpdate.bind(this)
    );

    this.labCommandsSubscription =
      this.rootStore._dataBinder.subscribeNamespace('lab-commands');
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

  public async sendLabCommand(command: LabCommandData): Promise<Result<null>> {
    return await this.labCommandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify(command)
    );
  }

  public async deployLab(lab: Lab): Promise<Result<null>> {
    return this.sendLabCommand({
      labId: lab.id,
      command: LabCommand.Deploy,
    });
  }

  public async destroyLab(lab: Lab): Promise<Result<null>> {
    return this.sendLabCommand({
      labId: lab.id,
      command: LabCommand.Destroy,
    });
  }

  public async stopNode(lab: Lab, node: string): Promise<Result<null>> {
    return this.sendLabCommand({
      labId: lab.id,
      command: LabCommand.StopNode,
      node: node,
    });
  }

  public async startNode(lab: Lab, node: string): Promise<Result<null>> {
    return this.sendLabCommand({
      labId: lab.id,
      command: LabCommand.StartNode,
      node: node,
    });
  }

  @action
  protected handleUpdate(response: DataResponse<LabOut[]>): void {
    this.data = this.parseLabs(response.payload);
    this.lookup = new Map(this.data.map(lab => [lab.id, lab]));

    if (response.headers && response.headers.has('X-Total-Count')) {
      this.totalEntries = Number(response.headers!.get('X-Total-Count'));
    }
  }

  private onLabUpdate(labId: string) {
    if (labId === '' || this.lookup.has(labId)) {
      void this.fetch();
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
          : endTime >= dayjs(new Date()).toDate() &&
              startTime >= dayjs(new Date()).subtract(2, 'minutes').toDate()
            ? InstanceState.Scheduled
            : InstanceState.Inactive,
        instance: this.parseInstance(lab.instance),
      };
    });
  }

  private parseInstance(input?: InstanceOut): Instance | undefined {
    if (input === undefined) return undefined;

    return {
      ...input,
      nodeMap: new Map(input.nodes?.map(node => [node.name, node])),
    };
  }
}
