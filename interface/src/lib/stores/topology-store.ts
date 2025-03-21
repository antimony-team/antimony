import {action, observable, observe} from 'mobx';

import {RootStore} from '@sb/lib/stores/root-store';
import {DataStore} from '@sb/lib/stores/data-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {
  BindFile,
  BindFileIn,
  Topology,
  TopologyIn,
  TopologyOut,
} from '@sb/types/domain/topology';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

export class TopologyStore extends DataStore<
  Topology,
  TopologyIn,
  TopologyOut
> {
  @observable accessor bindFileLookup: Map<string, BindFile> = new Map();

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

    const [data, bindFiles] = this.manager.parseTopologies(
      response.payload,
      this.rootStore._schemaStore.clabSchema
    );
    this.data = data;
    this.bindFileLookup = new Map(bindFiles.map(file => [file.id, file]));

    this.lookup = new Map(this.data.map(topology => [topology.id, topology]));
  }

  public async addBindFile(topologyId: string, bindFile: BindFileIn) {
    const result = await this.rootStore._dataBinder.post<BindFileIn, void>(
      `${this.resourcePath}/${topologyId}/files`,
      bindFile
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  public async updateBindFile(
    topologyId: string,
    findFileId: string,
    bindFile: BindFileIn
  ) {
    console.log('UPDATE:', bindFile);
    const result = await this.rootStore._dataBinder.patch<BindFileIn, void>(
      `${this.resourcePath}/${topologyId}/files/${findFileId}`,
      bindFile
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  public async deleteBindFile(topologyId: string, bindFileId: string) {
    const result = await this.rootStore._dataBinder.delete<void>(
      `${this.resourcePath}/${topologyId}/files/${bindFileId}`
    );

    if (result.isOk()) await this.fetch();

    return result;
  }
}
