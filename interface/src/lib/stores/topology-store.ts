import {action, observable, runInAction} from 'mobx';

import {ArchiveUploadFile} from '@sb/components/editor-page/archive-upload-dialog/archive-upload-dialog';
import {buildTopologyMetadata} from '@sb/lib/graph/topology-graph';
import {DataBinder, DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DataStore, DataStoreDependency} from '@sb/lib/stores/data-store';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {RootStore} from '@sb/lib/stores/root-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyFormat} from '@sb/lib/topology/topology-format';
import {TopologyManager} from '@sb/lib/topology-manager';
import {
  BindFile,
  BindFileIn,
  Topology,
  TopologyAnnotations,
  TopologyDefinition,
  TopologyIn,
  TopologyOut,
} from '@sb/types/domain/topology';
import {TopologyModel} from '@sb/types/domain/topology-model';
import {Result} from '@sb/types/result';
import {uuid4, YAMLDocument} from '@sb/types/types';

export class TopologyStore extends DataStore<
  Topology,
  TopologyIn,
  TopologyOut
> {
  @observable accessor bindFileLookup: Map<string, BindFile> = new Map();

  public manager: TopologyManager;

  // The format the topologies are written in
  public readonly format: TopologyFormat<TopologyDefinition>;

  private dataBinder: DataBinder;
  private schemaStore: SchemaStore;
  private deviceStore: DeviceStore;

  constructor(
    rootStore: RootStore,
    dataBinder: DataBinder,
    schemaStore: SchemaStore,
    deviceStore: DeviceStore,
    format: TopologyFormat<TopologyDefinition>,
    dependencies: DataStoreDependency[] = [],
  ) {
    super(rootStore, dependencies);
    this.dataBinder = dataBinder;
    this.schemaStore = schemaStore;
    this.deviceStore = deviceStore;
    this.format = format;

    this.manager = new TopologyManager(this, deviceStore);
  }

  protected get resourcePath(): string {
    return '/topologies';
  }

  public override async update(
    id: uuid4,
    body: Partial<TopologyIn>,
  ): Promise<Result<DataResponse<void>>> {
    const result = await super.update(id, body, false);

    if (result.isErr()) {
      return result;
    }

    await this.fetchSingle(id);

    return result;
  }

  public async fetchSingle(topologyId: string) {
    const response = await this.rootStore._dataBinder.get<TopologyOut>(
      this.resourcePath + '/' + topologyId,
    );

    if (response.isOk()) {
      const topologyOut = response.data.payload;

      const existingTopology = this.lookup.get(topologyOut.id);
      if (existingTopology) {
        this.updateTopologyValues(existingTopology, topologyOut);
        runInAction(() => {
          this.data = [...this.data];
        });
      } else {
        runInAction(() => {
          this.data = [...this.data, this.parseTopology(topologyOut)!];
        });
      }

      for (const bindFile of topologyOut.bindFiles) {
        if (this.bindFileLookup.has(bindFile.id)) {
          runInAction(() => {
            Object.assign(this.bindFileLookup.get(bindFile.id)!, bindFile);
          });
        } else {
          runInAction(() => {
            this.bindFileLookup.set(bindFile.id, bindFile);
          });
        }
      }
    }
  }

  public async uploadArchiveFiles(
    topologyId: string,
    files: ArchiveUploadFile[],
  ): Promise<Result<void>> {
    for (const file of files) {
      let result: Result<DataResponse<string>>;

      if (file.exists) {
        const existing = this.bindFileLookup
          .values()
          .find(bindFile => bindFile.filePath === file.filePath);

        result = await this.dataBinder.patch<BindFileIn, string>(
          `${this.resourcePath}/${topologyId}/files/${existing!.id}`,
          {
            filePath: file.filePath,
            content: file.content,
          },
        );
      } else {
        result = await this.dataBinder.post<BindFileIn, string>(
          `${this.resourcePath}/${topologyId}/files`,
          {
            filePath: file.filePath,
            content: file.content,
          },
        );
      }

      if (result.isErr()) {
        return result;
      }
    }

    await this.fetchSingle(topologyId);
    return Result.createOk(undefined);
  }

  public async addBindFile(
    topologyId: string,
    bindFile: BindFileIn,
    skipFetch: boolean = false,
  ): Promise<Result<DataResponse<string>>> {
    const result = await this.dataBinder.post<BindFileIn, string>(
      `${this.resourcePath}/${topologyId}/files`,
      bindFile,
    );

    if (result.isOk() && !skipFetch) await this.fetchSingle(topologyId);

    return result;
  }

  public async updateBindFile(
    topologyId: string,
    bindFileId: string,
    bindFile: Partial<BindFileIn>,
    skipFetch: boolean = false,
  ) {
    const result = await this.dataBinder.patch<BindFileIn, void>(
      `${this.resourcePath}/${topologyId}/files/${bindFileId}`,
      bindFile,
    );

    if (result.isOk() && !skipFetch) await this.fetchSingle(topologyId);

    return result;
  }

  public async deleteBindFile(
    topologyId: string,
    bindFileId: string,
    skipFetch: boolean = false,
  ) {
    const result = await this.dataBinder.delete<void>(
      `${this.resourcePath}/${topologyId}/files/${bindFileId}`,
    );

    if (result.isOk() && !skipFetch) await this.fetchSingle(topologyId);

    return result;
  }

  /**
   * Reads the text of a topology as a model, null if it isn't valid. The model
   * keeps the text as it's written.
   */
  public readTopology(
    definitionString: string,
  ): TopologyModel<TopologyDefinition> | null {
    const model = this.format.read(definitionString);
    if (!model || !this.schemaStore.clabValidator?.(model.document.toJS())) {
      return null;
    }

    return model;
  }

  // The document of a topology's text, its model is read along with it
  public parseTopologyDefinition(
    definitionString: string,
  ): YAMLDocument<TopologyDefinition> | null {
    return this.readTopology(definitionString)?.document ?? null;
  }

  public parseTopologyAnnotations(
    annotationsString: string,
  ): TopologyAnnotations | null {
    let annotations: TopologyAnnotations;

    try {
      annotations = JSON.parse(annotationsString);
    } catch {
      return null;
    }

    if (
      this.schemaStore.annotationsValidator &&
      !this.schemaStore.annotationsValidator(annotations)
    ) {
      return null;
    }

    return annotations;
  }

  @action
  protected handleUpdate(response: DataResponse<TopologyOut[]>): void {
    if (!this.schemaStore.clabSchema) return;

    const topologies: Topology[] = [];
    const bindFiles: BindFile[] = [];

    for (const topologyOut of response.payload) {
      const existingTopology = this.lookup.get(topologyOut.id);
      if (existingTopology) {
        this.updateTopologyValues(existingTopology, topologyOut);
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
    this.bindFileLookup = new Map(bindFiles.map(file => [file.id, file]));
  }

  @action
  private updateTopologyValues(
    target: Topology,
    source: TopologyOut | Partial<TopologyIn>,
  ) {
    if (source.definition) {
      const model = this.readTopology(source.definition);

      if (model) {
        const updatedDefinition = model.document;
        const metadata = buildTopologyMetadata(updatedDefinition, kind =>
          this.deviceStore.getInterfaceConfig(kind),
        );

        target.name = updatedDefinition.get('name') as string;
        target.model = model;
        target.definition = updatedDefinition;
        target.definitionString = source.definition;
        target.nodeCount = metadata.nodeCount;
        target.connections = metadata.connections;
        target.connectionMap = metadata.connectionMap;
      } else {
        console.error('[NET] Failed to parse incoming topology: ', source);
      }
    }

    if (source.annotations) {
      const updatedAnnotations = this.parseTopologyAnnotations(
        source.annotations,
      );

      if (updatedAnnotations) {
        target.annotations = updatedAnnotations;
        target.annotationsString = source.annotations;
      } else {
        console.error('[NET] Failed to parse incoming annotations: ', source);
      }
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

  private parseTopology(input: TopologyOut): Topology | null {
    const model = this.readTopology(input.definition);
    const definition = model?.document;

    if (!model || !definition) {
      console.error('[NET] Failed to parse incoming topology: ', input);
      return null;
    }

    // Broken annotations only lose the layout, the topology itself is still usable
    const annotations = this.parseTopologyAnnotations(input.annotations);

    if (!annotations) {
      console.error('[NET] Failed to parse incoming annotations: ', input);
    }

    return observable(
      {
        ...input,
        name: definition.get('name') as string,
        model: model,
        definition: definition,
        definitionString: input.definition,
        annotations: annotations ?? {},
        annotationsString: input.annotations,
        ...buildTopologyMetadata(definition, kind =>
          this.deviceStore.getInterfaceConfig(kind),
        ),
      },
      // The model and the annotations are replaced as a whole on every edit
      {model: observable.ref, annotations: observable.ref},
    );
  }
}
