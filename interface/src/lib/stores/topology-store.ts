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
import {action, observable, observe, toJS} from 'mobx';
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
        this.assignExisting(existingTopology, topologyOut);
        topologies.push(existingTopology);
      } else {
        const topology = this.parseTopology(topologyOut);
        if (!topology) continue;

        topologies.push(topology);

        for (const bindFile of topologyOut.bindFiles) {
          bindFiles.push(bindFile);
        }
      }
    }

    this.data = topologies;
    this.lookup = new Map(this.data.map(topology => [topology.id, topology]));
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
      console.log('Updating existing object: ', toJS(existingTopology));

      this.assignExisting(existingTopology, body);

      console.log('Updating existing object: ', toJS(existingTopology));
    } else {
      await this.fetch();
    }

    return result;
  }

  @action
  protected assignExisting(
    topology: Topology,
    updated: TopologyOut | Partial<TopologyIn>,
  ): void {
    if (
      updated.definition &&
      topology.definitionString !== updated.definition
    ) {
      const definition = this.parseTopologyDefinition(updated.definition);

      if (!definition) {
        console.error('[NET] Failed to parse incoming topology: ', updated);
      } else {
        const metadata = this.manager.buildTopologyMetadata(definition);

        topology.name = definition.get('name') as string;
        topology.definition = definition;
        topology.definitionString = updated.definition;
        topology.connections = metadata.connections;
        topology.connectionMap = metadata.connectionMap;
      }
    }

    if (updated.syncUrl !== undefined) {
      topology.syncUrl = updated.syncUrl;
    }

    if (updated.collectionId !== undefined) {
      topology.collectionId = updated.collectionId;
    }

    if ((updated as TopologyOut).creator) {
      topology.creator = (updated as TopologyOut).creator;
    }

    if ((updated as TopologyOut).bindFiles) {
      topology.bindFiles = (updated as TopologyOut).bindFiles;
    }

    if ((updated as TopologyOut).lastDeployFailed) {
      topology.lastDeployFailed = (updated as TopologyOut).lastDeployFailed;
    }
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
