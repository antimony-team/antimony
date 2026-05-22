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
import {uuid4, YAMLDocument} from '@sb/types/types';
import {validate} from 'jsonschema';
import {action, observable, observe} from 'mobx';
import {parseDocument} from 'yaml';
import {Result} from '@sb/types/result';

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
    if (!this.schemaStore.clabSchema) return;

    const topologies: Topology[] = [];
    const bindFiles: BindFile[] = [];

    for (const topologyOut of response.payload) {
      const existingTopology = this.lookup.get(topologyOut.id);
      if (existingTopology) {
        this.assignTopology(existingTopology, topologyOut);
        topologies.push(existingTopology);
      } else {
        const topology = this.parseTopology(topologyOut);
        if (!topology) continue;

        topologies.push(topology);
      }

      for (const bindFile of topologyOut.bindFiles) {
        bindFiles.push(bindFile);
      }
    }

    this.data = topologies;
    this.lookup = new Map(this.data.map(topology => [topology.id, topology]));
    console.log('bind files: ', bindFiles);
    this.bindFileLookup = new Map(bindFiles.map(file => [file.id, file]));
  }

  public override async update(
    id: uuid4,
    body: Partial<TopologyIn>,
  ): Promise<Result<DataResponse<void>>> {
    const result = await super.update(id, body, false);

    if (result.isErr()) {
      return result;
    }

    if (this.lookup.has(id)) {
      const existingTopology = this.lookup.get(id)!;
      this.assignTopology(existingTopology, body);
    } else {
      await this.fetch();
    }

    return result;
  }

  @action
  public assignTopology(
    target: Topology,
    source: TopologyOut | Partial<TopologyIn> | Topology,
  ): void {
    let updatedDefinition = null;

    if (source.definition) {
      // Definition can either be a string or a YAML document
      if (typeof source.definition === 'string') {
        if (target.definitionString !== source.definition) {
          updatedDefinition = this.parseTopologyDefinition(source.definition);

          if (!updatedDefinition) {
            console.error('[NET] Failed to parse incoming topology: ', source);
          }
        }
      } else {
        updatedDefinition =
          source.definition as YAMLDocument<TopologyDefinition>;
      }
    }

    if (updatedDefinition) {
      console.log('updated definition:', updatedDefinition);
      const metadata = this.manager.buildTopologyMetadata(updatedDefinition);

      target.name = updatedDefinition.get('name') as string;
      target.definition = updatedDefinition;
      target.definitionString = updatedDefinition.toString();
      target.connections = metadata.connections;
      target.connectionMap = metadata.connectionMap;
    }

    if (source.syncUrl !== undefined) {
      target.syncUrl = source.syncUrl;
    }

    if (source.collectionId !== undefined) {
      target.collectionId = source.collectionId;
    }

    if ((source as TopologyOut).creator) {
      target.creator = (source as TopologyOut).creator;
    }

    if ((source as TopologyOut).bindFiles) {
      target.bindFiles = (source as TopologyOut).bindFiles;
    }

    if ((source as TopologyOut).lastDeployFailed) {
      target.lastDeployFailed = (source as TopologyOut).lastDeployFailed;
    }
  }

  public async addBindFile(
    topologyId: string,
    bindFile: BindFileIn,
  ): Promise<Result<DataResponse<string>>> {
    const result = await this.dataBinder.post<BindFileIn, string>(
      `${this.resourcePath}/${topologyId}/files`,
      bindFile,
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  public async updateBindFile(
    topologyId: string,
    bindFileId: string,
    bindFile: BindFileIn,
  ) {
    const result = await this.dataBinder.patch<BindFileIn, void>(
      `${this.resourcePath}/${topologyId}/files/${bindFileId}`,
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

  private parseTopology(input: TopologyOut): Topology | null {
    const definition = this.parseTopologyDefinition(input.definition);

    if (!definition) {
      console.error('[NET] Failed to parse incoming topology: ', input);
      return null;
    }

    return observable({
      ...input,
      name: definition.get('name') as string,
      definition: definition,
      definitionString: input.definition,
      ...this.manager.buildTopologyMetadata(definition),
    });
  }

  public parseTopologyDefinition(
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
