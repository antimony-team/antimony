import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DataStore} from '@sb/lib/stores/data-store';

import {RootStore} from '@sb/lib/stores/root-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {ClabSchema} from '@sb/types/domain/schema';
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

    const [data, bindFiles] = this.parseTopologies(
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
    const result = await this.rootStore._dataBinder.put<BindFileIn, void>(
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

  private parseTopologies(
    input: TopologyOut[],
    schema: ClabSchema
  ): [Topology[], BindFile[]] {
    const topologies: Topology[] = [];
    const bindFiles: BindFile[] = [];
    for (const topologyOut of input) {
      const definition = this.parseTopology(topologyOut.definition, schema);

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
          b.definition.get('name') as string
        )
      ),
      bindFiles,
    ];
  }

  public parseTopology(
    definitionString: string,
    schema: ClabSchema
  ): YAMLDocument<TopologyDefinition> | null {
    const definition = parseDocument(definitionString, {
      keepSourceTokens: true,
    });
    if (
      definition.errors.length > 0 ||
      validate(definition.toJS(), schema).errors.length > 0
    ) {
      return null;
    }

    return definition;
  }
}
