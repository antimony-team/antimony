import {DataBinder, DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DataStore} from '@sb/lib/stores/data-store';
import {DeviceStore} from '@sb/lib/stores/device-store';

import {RootStore} from '@sb/lib/stores/root-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {
  BindFile,
  BindFileIn,
  Topology,
  TopologyDefinition,
  TopologyIn,
  TopologyOut,
} from '@sb/types/domain/topology';
import {YAMLDocument} from '@sb/types/types';
import {validate} from 'jsonschema';
import {action, observable, observe} from 'mobx';
import {parseDocument} from 'yaml';

export class TopologyStore extends DataStore<
  Topology,
  TopologyIn,
  TopologyOut
> {
  @observable accessor bindFileLookup: Map<string, BindFile> = new Map();

  public manager: TopologyManager;

  private dataBinder: DataBinder;
  private schemaStore: SchemaStore;

  constructor(
    rootStore: RootStore,
    dataBinder: DataBinder,
    schemaStore: SchemaStore,
    deviceStore: DeviceStore,
  ) {
    super(rootStore);
    this.dataBinder = dataBinder;
    this.schemaStore = schemaStore;

    this.manager = new TopologyManager(this, deviceStore);

    observe(rootStore._schemaStore, () => this.fetch());
  }

  protected get resourcePath(): string {
    return '/topologies';
  }

  @action
  protected handleUpdate(response: DataResponse<TopologyOut[]>): void {
    const [data, bindFiles] = this.parseTopologies(response.payload);
    this.data = data;
    this.bindFileLookup = new Map(bindFiles.map(file => [file.id, file]));

    this.lookup = new Map(this.data.map(topology => [topology.id, topology]));
  }

  public async addBindFile(topologyId: string, bindFile: BindFileIn) {
    const result = await this.dataBinder.post<BindFileIn, void>(
      `${this.resourcePath}/${topologyId}/files`,
      bindFile,
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  public async updateBindFile(
    topologyId: string,
    findFileId: string,
    bindFile: BindFileIn,
  ) {
    const result = await this.dataBinder.put<BindFileIn, void>(
      `${this.resourcePath}/${topologyId}/files/${findFileId}`,
      bindFile,
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  public async deleteBindFile(topologyId: string, bindFileId: string) {
    const result = await this.dataBinder.delete<void>(
      `${this.resourcePath}/${topologyId}/files/${bindFileId}`,
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  private parseTopologies(input: TopologyOut[]): [Topology[], BindFile[]] {
    const topologies: Topology[] = [];
    const bindFiles: BindFile[] = [];
    for (const topologyOut of input) {
      const definition = this.parseTopology(topologyOut.definition);

      if (!definition) {
        console.error('[NET] Failed to parse incoming topology: ', topologyOut);
        continue;
      }

      const topology: Topology = {
        ...topologyOut,
        name: definition.get('name') as string,
        definition: definition,
        definitionString: topologyOut.definition,
        ...this.manager.buildTopologyMetadata(definition),
      };

      bindFiles.push(...topology.bindFiles);
      topologies.push(topology);
    }

    return [
      topologies.toSorted((a, b) =>
        (a.definition.get('name') as string)?.localeCompare(
          b.definition.get('name') as string,
        ),
      ),
      bindFiles,
    ];
  }

  public parseTopology(
    definitionString: string,
  ): YAMLDocument<TopologyDefinition> | null {
    const definition = parseDocument(definitionString, {
      keepSourceTokens: true,
    });
    if (
      definition.errors.length > 0 ||
      validate(definition.toJS(), this.schemaStore.clabSchema).errors.length > 0
    ) {
      return null;
    }

    return definition;
  }
}
