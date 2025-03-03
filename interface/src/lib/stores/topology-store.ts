import {action, observe} from 'mobx';

import {RootStore} from '@sb/lib/stores/root-store';
import {DataStore} from '@sb/lib/stores/data-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {Topology, TopologyIn, TopologyOut} from '@sb/types/domain/topology';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

export class TopologyStore extends DataStore<
  Topology,
  TopologyIn,
  TopologyOut
> {
  public manager: TopologyManager;

  constructor(rootStore: RootStore) {
    super(rootStore);
    this.manager = new TopologyManager(
      this.rootStore._dataBinder,
      this,
      this.rootStore._deviceStore
    );

    observe(rootStore._schemaStore, () => this.fetch());
  }

  protected get resourcePath(): string {
    return '/topologies';
  }

  @action
  protected handleUpdate(response: DataResponse<TopologyOut[]>): void {
    if (!this.rootStore._schemaStore?.clabSchema) return;

    this.data = this.manager.parseTopologies(
      response.payload,
      this.rootStore._schemaStore.clabSchema
    );
    this.lookup = new Map(this.data.map(topology => [topology.id, topology]));
  }
}
