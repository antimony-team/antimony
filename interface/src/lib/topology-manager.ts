import {cloneDeep} from 'lodash-es';
import {runInAction} from 'mobx';
import {isMap, YAMLMap, YAMLSeq} from 'yaml';

import {
  buildTopologyMetadata,
  parseInterface,
} from '@sb/lib/graph/topology-graph';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {Binding} from '@sb/lib/utils/binding';
import {
  BindFile,
  NodeConnection,
  Topology,
  TopologyDefinition,
} from '@sb/types/domain/topology';
import {Result} from '@sb/types/result';
import {Position, YAMLDocument} from '@sb/types/types';

export type TopologyEditReport = {
  updatedTopology: Topology;

  // Whether the topology is different to the saved one
  isEdited: boolean;

  /*
   * This field makes it so components can identify if an update comes from
   * themselves or some other source and update accordingly.
   */
  source: TopologyEditSource;
};

export type BindFileEditReport = {
  updatedBindFile: BindFile;

  // Whether the topology is different to the saved one
  isEdited: boolean;

  /*
   * This field makes it so components can identify if an update comes from
   * themselves or some other source and update accordingly.
   */
  source: BindFileEditSource;
};

export enum TopologyEditSource {
  NodeEditor,
  TextEditor,
  System,
}

export enum BindFileEditSource {
  TextEditor,
  System,
}

export enum OpenFileType {
  Topology,
  BindFile,
}

export class TopologyManager {
  public readonly onTopologyOpen: Binding<Topology> = new Binding();
  public readonly onTopologyEdit: Binding<TopologyEditReport> = new Binding();
  public readonly onBindFileOpen: Binding<BindFile> = new Binding();
  public readonly onBindFileEdit: Binding<BindFileEditReport> = new Binding();
  public readonly onClose: Binding<void> = new Binding();
  private deviceStore: DeviceStore;
  private topologyStore: TopologyStore;
  private isFileOpen: boolean = false;
  private openFileType: OpenFileType = OpenFileType.Topology;
  private editingTopology: Topology | null = null;
  // Backup of the topology to restore when discarding edits.
  private originalTopology: Topology | null = null;
  // The serialized definition of the original topology, which edits are compared against
  private originalDefinitionCache: {
    topology: Topology;
    definition: string;
  } | null = null;
  private editingBindFile: BindFile | null = null;
  // Backup of the bind file to restore when discarding edits.
  private originalBindFile: BindFile | null = null;

  constructor(topologyStore: TopologyStore, deviceStore: DeviceStore) {
    this.deviceStore = deviceStore;
    this.topologyStore = topologyStore;
    this.onTopologyEdit.register(
      updateReport => (this.editingTopology = updateReport.updatedTopology),
    );

    // Bind these functions to the class so they can be called from the view directly
    this.clear = this.clear.bind(this);
    this.save = this.save.bind(this);
  }

  public get editingFileId(): string | null {
    if (this.openFileType === OpenFileType.Topology) {
      return this.editingTopology?.id ?? null;
    } else if (this.openFileType === OpenFileType.BindFile) {
      return this.editingBindFile?.id ?? null;
    }
    return null;
  }

  public get currentFileType() {
    return this.openFileType;
  }

  public get topology() {
    return this.editingTopology;
  }

  public get bindFile() {
    return this.editingBindFile;
  }

  public static serializeTopology(
    definition: YAMLDocument<TopologyDefinition>,
  ) {
    return definition.toString({
      collectionStyle: 'block',
    });
  }

  /**
   * Parses a position string to a position object. Returns null if the parsing
   * failed.
   *
   * Format: pos=[x, y]
   */
  private static readPosition(
    value: string | null | undefined,
  ): Position | null {
    if (!value) return null;

    const matches = value.replaceAll(' ', '').match(/pos=\[(-?\d+),(-?\d+)]/);
    if (matches && matches.length === 3) {
      const x = Number(matches[1]);
      const y = Number(matches[2]);
      if (!isNaN(x) && !isNaN(y)) {
        return {x, y};
      }
    }

    return null;
  }

  /**
   * Creates a position string from a position object.
   *
   * Format: pos=[x, y]
   */
  private static writePosition(position: Position) {
    return ' pos=[' + position.x + ',' + position.y + ']';
  }

  private static cloneBindFile(bindFile: BindFile): BindFile {
    return {
      id: bindFile.id,
      filePath: bindFile.filePath,
      content: bindFile.content,
      topologyId: bindFile.topologyId,
    };
  }

  private static cloneTopology(topology: Topology): Topology {
    return {
      id: topology.id,
      name: topology.name,
      collectionId: topology.collectionId,
      creator: {
        id: topology.creator.id,
        name: topology.creator.name,
      },
      nodeCount: topology.nodeCount,
      connections: cloneDeep(topology.connections),
      connectionMap: cloneDeep(topology.connectionMap),
      definition: topology.definition.clone(),
      definitionString: topology.definitionString,
      syncUrl: topology.syncUrl,
      bindFiles: cloneDeep(topology.bindFiles),
      lastDeployFailed: topology.lastDeployFailed,
    };
  }

  public async save(): Promise<Result<DataResponse<void>> | null> {
    if (this.openFileType === OpenFileType.Topology) {
      return this.saveTopology();
    } else if (this.openFileType === OpenFileType.BindFile) {
      return this.saveBindFile();
    }

    return null;
  }

  public discardEdits() {
    if (this.openFileType === OpenFileType.Topology) {
      if (!this.editingTopology || !this.originalTopology) return;

      this.onTopologyEdit.update({
        updatedTopology: this.originalTopology,
        isEdited: false,
        source: TopologyEditSource.System,
      });
    } else if (this.openFileType === OpenFileType.BindFile) {
      if (!this.editingBindFile || !this.originalBindFile) return;

      console.log('DISCARDING BIND FILE EDITS');
      this.editingBindFile.content = this.originalBindFile.content;

      this.onBindFileEdit.update({
        updatedBindFile: this.originalBindFile,
        isEdited: false,
        source: BindFileEditSource.System,
      });
    }
  }

  public updateNodeLabels(
    labelMap: Map<string, Record<string, string | number | null>>,
  ) {
    if (!this.editingTopology) return;

    const updatedTopology = this.editingTopology.definition.clone();
    const nodeMap = updatedTopology.getIn(['topology', 'nodes']) as YAMLMap;

    for (const [nodeId, nodeLabels] of labelMap.entries()) {
      const yamlNode = nodeMap.get(nodeId);
      if (!isMap(yamlNode)) continue;

      for (const [labelKey, labelValue] of Object.entries(nodeLabels)) {
        if (labelValue === null) {
          if (!yamlNode.get('labels')) continue;

          yamlNode.deleteIn(['labels', labelKey]);
        } else {
          yamlNode.setIn(['labels', labelKey], labelValue);
        }
      }
    }

    this.editTopology(updatedTopology, TopologyEditSource.NodeEditor);
  }

  /**
   * Returns whether a topology is currently open.
   */
  public isOpen(): boolean {
    return this.isFileOpen;
  }

  /**
   * Opens a new topology to edit.
   *
   * @param topology The topology to edit.
   */
  public openTopology(topology: Topology) {
    this.restoreCurrentFile();

    this.isFileOpen = true;
    this.openFileType = OpenFileType.Topology;

    this.editingBindFile = null;
    this.originalBindFile = null;

    this.editingTopology = topology;
    this.originalTopology = TopologyManager.cloneTopology(topology);

    this.onTopologyOpen.update(this.editingTopology);
  }

  public openBindFile(bindFile: BindFile) {
    this.restoreCurrentFile();

    this.isFileOpen = true;
    this.openFileType = OpenFileType.BindFile;

    this.editingTopology = null;
    this.originalTopology = null;

    this.editingBindFile = bindFile;
    this.originalBindFile = TopologyManager.cloneBindFile(bindFile);

    this.onBindFileOpen.update(this.editingBindFile);
  }

  /**
   * Closes the currently opened file.
   */
  public close() {
    this.isFileOpen = false;

    this.editingTopology = null;
    this.originalTopology = null;

    this.editingBindFile = null;
    this.originalBindFile = null;

    this.onClose.update();
  }

  /**
   * Replaces the currently opened topoloogy with the provided topology.
   *
   * Contrary to a regular edit, the provided topology is treated as the new
   * original, and an onTopologyEdit event is fired with isEdited set to false.
   *
   * This can be used when the topology has been updated in the background and
   * needs to be refreshed (e.g., when the user changes the topology's name
   * via the edit dialog).
   */
  public replaceTopology(originalTopology: Topology) {
    this.editingTopology = originalTopology;
    this.originalTopology = TopologyManager.cloneTopology(originalTopology);

    this.onTopologyEdit.update({
      updatedTopology: this.editingTopology,
      isEdited: false,
      source: TopologyEditSource.System,
    });
  }

  public editTopology(
    updatedTopology: YAMLDocument<TopologyDefinition>,
    source: TopologyEditSource,
  ) {
    if (!this.editingTopology) return;

    const topologyMeta = buildTopologyMetadata(updatedTopology, kind =>
      this.deviceStore.getInterfaceConfig(kind),
    );

    runInAction(() => {
      this.editingTopology!.definition = updatedTopology;
      this.editingTopology!.connections = topologyMeta.connections;
      this.editingTopology!.connectionMap = topologyMeta.connectionMap;
    });

    this.onTopologyEdit.update({
      updatedTopology: this.editingTopology,
      isEdited: updatedTopology.toString() !== this.getOriginalDefinition(),
      source,
    });
  }

  public editBindFile(
    updatedBindFileContent: string,
    source: BindFileEditSource,
  ) {
    if (!this.editingBindFile) return;

    this.editingBindFile.content = updatedBindFileContent;

    this.onBindFileEdit.update({
      updatedBindFile: this.editingBindFile,
      isEdited: updatedBindFileContent !== this.originalBindFile?.content,
      source,
    });
  }

  public clear() {
    if (this.openFileType === OpenFileType.Topology) {
      if (!this.editingTopology) return;

      const updatedTopology = {
        name: this.editingTopology.definition.toJS().name,
        topology: {
          nodes: {},
        },
      };

      this.editTopology(
        new YAMLDocument(updatedTopology),
        TopologyEditSource.System,
      );
    } else if (this.openFileType === OpenFileType.BindFile) {
      if (!this.editingBindFile) return;

      this.editBindFile('', BindFileEditSource.System);
    }
  }

  /**
   * Deletes a node from the topology.
   *
   * @param nodeName The name of the node to delete.
   */
  public deleteNode(nodeName: string) {
    if (!this.editingTopology) return;

    const updatedTopology = this.editingTopology.definition.clone();
    const wasDeleted = updatedTopology.deleteIn([
      'topology',
      'nodes',
      nodeName,
    ]);
    if (!wasDeleted) return;

    this.editTopology(updatedTopology, TopologyEditSource.NodeEditor);
  }

  /**
   * Connects two nodes in the topology.
   *
   * @param nodeName1 The name of the first node to connect.
   * @param nodeName2 The name of the second node to connect.
   */
  public connectNodes(nodeName1: string, nodeName2: string) {
    if (!this.editingTopology || !this.deviceStore.data) return;

    const updatedTopology = this.editingTopology.definition.clone();

    const nodeKind1 = updatedTopology.getIn([
      'topology',
      'nodes',
      nodeName1,
      'kind',
    ]) as string | undefined;

    const nodeKind2 = updatedTopology.getIn([
      'topology',
      'nodes',
      nodeName1,
      'kind',
    ]) as string | undefined;

    const hostInterface = this.getNextInterface(nodeName1, nodeKind1);
    const targetInterface = this.getNextInterface(nodeName2, nodeKind2);

    if (!updatedTopology.hasIn(['topology', 'links'])) {
      updatedTopology.setIn(['topology', 'links'], new YAMLSeq());
    }

    const links = updatedTopology.getIn(['topology', 'links']) as YAMLSeq;

    links.add({
      endpoints: [
        `${nodeName1}:${hostInterface}`,
        `${nodeName2}:${targetInterface}`,
      ],
    });

    this.editTopology(updatedTopology, TopologyEditSource.NodeEditor);
  }

  public disconnectNodes(nodeName1: string, nodeName2: string) {
    if (!this.editingTopology || !this.deviceStore.data) return;

    const updatedTopology = this.editingTopology.definition.clone();

    const links = updatedTopology.getIn(['topology', 'links']) as YAMLSeq;

    for (const linksKey in links.items) {
      const endpoints = (
        updatedTopology.getIn([
          'topology',
          'links',
          linksKey,
          'endpoints',
        ]) as YAMLSeq
      ).toJS(updatedTopology);

      const node1 = endpoints[0].split(':')[0];
      const node2 = endpoints[1].split(':')[0];

      if (node1 === nodeName1 && node2 === nodeName2) {
        updatedTopology.deleteIn(['topology', 'links', linksKey]);
        break;
      }
    }

    this.editTopology(updatedTopology, TopologyEditSource.NodeEditor);
  }

  /**
   * Returns whether the currently open topology has been edited.
   *
   * Edit means that the editing topology has been changed, but these changes
   * have not yet been saved and synced with the server.
   */
  public hasEdits() {
    if (this.openFileType === OpenFileType.Topology) {
      if (!this.editingTopology || !this.originalTopology) return false;

      return (
        this.editingTopology.definition.toString() !==
        this.getOriginalDefinition()
      );
    } else {
      if (!this.editingBindFile || !this.originalBindFile) return false;

      return this.editingBindFile.content !== this.originalBindFile.content;
    }
  }

  private async saveTopology(): Promise<Result<DataResponse<void>> | null> {
    if (!this.editingTopology) return null;

    const result = await this.topologyStore.update(this.editingTopology.id, {
      definition: TopologyManager.serializeTopology(
        this.editingTopology.definition,
      ),
    });

    if (result.isOk()) {
      this.originalTopology = TopologyManager.cloneTopology(
        this.editingTopology,
      );

      this.onTopologyEdit.update({
        updatedTopology: this.editingTopology,
        isEdited: false,
        source: TopologyEditSource.System,
      });
    }

    return result;
  }

  private async saveBindFile(): Promise<Result<DataResponse<void>> | null> {
    if (!this.editingBindFile) return null;

    const result = await this.topologyStore.updateBindFile(
      this.editingBindFile.topologyId,
      this.editingBindFile.id,
      {
        content: this.editingBindFile.content,
      },
    );

    if (result.isOk()) {
      this.originalBindFile = TopologyManager.cloneBindFile(
        this.editingBindFile,
      );

      this.onBindFileEdit.update({
        updatedBindFile: this.editingBindFile,
        isEdited: false,
        source: BindFileEditSource.System,
      });
    }

    return result;
  }

  /**
   * Returns the serialized definition of the original topology. The original
   * is replaced whenever it changes, so it is only serialized once per original.
   */
  private getOriginalDefinition(): string | null {
    if (!this.originalTopology) return null;

    if (this.originalDefinitionCache?.topology !== this.originalTopology) {
      this.originalDefinitionCache = {
        topology: this.originalTopology,
        definition: this.originalTopology.definition.toString(),
      };
    }

    return this.originalDefinitionCache.definition;
  }

  private restoreCurrentFile() {
    if (this.openFileType === OpenFileType.Topology) {
      if (!this.editingTopology || !this.originalTopology) return;

      void this.topologyStore.fetchSingle(this.editingTopology.id);
    } else {
      if (!this.editingBindFile) return;

      void this.topologyStore.fetchSingle(this.editingBindFile.topologyId);
    }
  }

  /**
   * Returns all connections of a node.
   */
  private getNodeConnections(nodeName: string) {
    if (!this.editingTopology) return [];
    this.editingTopology?.connections.filter(
      connection =>
        connection.hostNode === nodeName || connection.targetNode === nodeName,
    );
  }

  /**
   * Generates a valid interface ID for a given node.
   */
  private getNextInterface(nodeName: string, nodeKind?: string): string {
    if (!this.editingTopology) return '';

    const deviceInfo = this.deviceStore.getInterfaceConfig(nodeKind);
    const assignedNumbers = new Set(
      this.getAssignedInterfaces(
        nodeName,
        deviceInfo.interfacePattern,
        this.editingTopology.connectionMap,
      ),
    );

    let checkIndex = deviceInfo.interfaceStart;
    let validIndexFound = false;
    while (!validIndexFound) {
      if (!assignedNumbers.has(checkIndex)) {
        validIndexFound = true;
        break;
      }
      checkIndex++;
    }

    return `${deviceInfo.interfacePattern.replaceAll('$', String(checkIndex))}`;
  }

  /**
   * Returns all assigned interface numbers for a given node.
   */
  private getAssignedInterfaces(
    nodeName: string,
    interfacePattern: string,
    connectionMap: Map<string, NodeConnection[]>,
  ): number[] {
    return (connectionMap.get(nodeName) ?? [])
      .map(connection =>
        parseInterface(connection.hostInterface, interfacePattern),
      )
      .filter(index => index >= 0);
  }
}
