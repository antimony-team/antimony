import {DataBinder, DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';

import {Binding} from '@sb/lib/utils/binding';
import {pushOrCreateList} from '@sb/lib/utils/utils';
import {
  NodeConnection,
  Topology,
  TopologyDefinition,
} from '@sb/types/domain/topology';
import {Result} from '@sb/types/result';
import {Position, YAMLDocument} from '@sb/types/types';
import {cloneDeep, isEqual} from 'lodash-es';
import {isMap, YAMLMap, YAMLSeq} from 'yaml';

export type TopologyEditReport = {
  updatedTopology: Topology;

  // Whether the topology is different to the saved one
  isEdited: boolean;

  /*
   * This field makes it so components can identify if the update comes from
   * them or some other source and update accordingly.
   */
  source: TopologyEditSource;
};

export enum TopologyEditSource {
  NodeEditor,
  TextEditor,
  System,
}

export class TopologyManager {
  private apiStore: DataBinder;
  private deviceStore: DeviceStore;
  private topologyStore: TopologyStore;
  private editingTopology: Topology | null = null;
  private originalTopology: Topology | null = null;

  public readonly onOpen: Binding<Topology> = new Binding();
  public readonly onClose: Binding<void> = new Binding();
  public readonly onEdit: Binding<TopologyEditReport> = new Binding();

  constructor(
    apiStore: DataBinder,
    topologyStore: TopologyStore,
    deviceStore: DeviceStore
  ) {
    this.apiStore = apiStore;
    this.deviceStore = deviceStore;
    this.topologyStore = topologyStore;
    this.onEdit.register(
      updateReport => (this.editingTopology = updateReport.updatedTopology)
    );

    // Bind these functions to the class so they can be called from the view directly
    this.clear = this.clear.bind(this);
    this.save = this.save.bind(this);
  }

  public get editingTopologyId(): string | null {
    return this.editingTopology?.id ?? null;
  }

  /**
   * Submits the current topology to the API and resets the referenced saved
   * topology to the current topology if the upload was successful.
   */
  public async save(): Promise<Result<DataResponse<void>> | null> {
    if (!this.editingTopology) return null;

    const result = await this.topologyStore.update(this.editingTopology.id, {
      collectionId: this.editingTopology.collectionId,
      definition: TopologyManager.serializeTopology(
        this.editingTopology.definition
      ),
      gitSourceUrl: this.editingTopology.gitSourceUrl,
    });

    if (result.isOk()) {
      await this.topologyStore.fetch();

      this.originalTopology = TopologyManager.cloneTopology(
        this.editingTopology
      );
      this.onEdit.update({
        updatedTopology: this.editingTopology,
        isEdited: false,
        source: TopologyEditSource.System,
      });
    }

    return result;
  }

  public updateSyncUrl(url: string) {
    if (!this.editingTopology) return;

    this.editingTopology.gitSourceUrl = url;
  }

  public updateNodeLabels(
    labelMap: Map<string, Record<string, string | number>>
  ) {
    if (!this.editingTopology) return;

    const updatedTopology = this.editingTopology.definition.clone();
    const nodeMap = updatedTopology.getIn(['topology', 'nodes']) as YAMLMap;

    for (const [nodeId, nodeLabels] of labelMap.entries()) {
      const yamlNode = nodeMap.get(nodeId);
      if (!isMap(yamlNode)) continue;

      for (const [labelKey, labelValue] of Object.entries(nodeLabels)) {
        if (labelValue === null) {
          yamlNode.deleteIn(['labels', labelKey]);
        } else {
          yamlNode.setIn(['labels', labelKey], labelValue);
        }
      }
    }

    this.apply(updatedTopology, TopologyEditSource.NodeEditor);
  }

  /**
   * Returns whether a topology is currently open.
   */
  public isOpen(): boolean {
    return this.editingTopology !== null;
  }

  /**
   * Opens a new topology to edit.
   *
   * @param topology The topology to edit.
   */
  public open(topology: Topology) {
    this.originalTopology = topology;
    this.editingTopology = TopologyManager.cloneTopology(topology);

    this.onOpen.update(this.editingTopology);
  }

  /**
   * Closes the current topology.
   */
  public close() {
    this.editingTopology = null;
    this.originalTopology = null;

    this.onClose.update();
  }

  /**
   * Replaces the current topology with a one and notifies all subscribers.
   *
   * @param updatedTopology The updated topology.
   * @param source The source of the update.
   */
  public apply(
    updatedTopology: YAMLDocument<TopologyDefinition>,
    source: TopologyEditSource
  ) {
    if (!this.editingTopology) return;

    const topologyMeta = this.buildTopologyMetadata(updatedTopology);

    this.onEdit.update({
      updatedTopology: {
        ...this.editingTopology,
        definition: updatedTopology,
        ...topologyMeta,
      },
      isEdited: !isEqual(
        updatedTopology.toString(),
        this.originalTopology?.definition.toString()
      ),
      source: source,
    });
  }

  /**
   * Removes all the nodes and links from the topology.
   */
  public clear() {
    if (!this.editingTopology) return;
    const updatedTopology = {
      name: this.editingTopology.definition.toJS().name,
      topology: {
        nodes: {},
      },
    };

    this.apply(
      new YAMLDocument(updatedTopology),
      TopologyEditSource.NodeEditor
    );
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

    this.apply(updatedTopology, TopologyEditSource.NodeEditor);
  }

  /**
   * Connects two nodes in the topology.
   *
   * @param nodeName1 The name of the first node to connect.
   * @param nodeName2 The name of ths second node to connect.
   */
  public connectNodes(nodeName1: string, nodeName2: string) {
    if (!this.editingTopology || !this.deviceStore.data) return;

    const updatedTopology = this.editingTopology.definition.clone();
    const hostInterface = this.getNextInterface(nodeName1);
    const targetInterface = this.getNextInterface(nodeName2);

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

    this.apply(updatedTopology, TopologyEditSource.NodeEditor);
  }

  /**
   * Returns whether the currently open topology has been edited.
   */
  public hasEdits() {
    if (!this.editingTopology || !this.originalTopology) return false;
    return !isEqual(
      this.editingTopology.definition.toString(),
      this.originalTopology.definition.toString()
    );
  }

  public get topology() {
    return this.editingTopology;
  }

  public getNodeTooltip(nodeName: string) {
    if (!this.editingTopology) return;

    // const node = (
    //   this.editingTopology.definition.getIn([
    //     'topology',
    //     'nodes',
    //     nodeName,
    //   ]) as YAMLMap
    // ).toJS(this.editingTopology.definition);
    return nodeName;
  }

  public getEdgeTooltip(connection: NodeConnection) {
    return `${connection.hostNode}:${connection.hostInterface} <···> ${connection.targetNode}:${connection.targetInterface}`;
  }

  /**
   * Returns all connections of a node.
   */
  private getNodeConnections(nodeName: string) {
    if (!this.editingTopology) return [];
    this.editingTopology?.connections.filter(
      connection =>
        connection.hostNode === nodeName || connection.targetNode === nodeName
    );
  }

  public static serializeTopology(
    definition: YAMLDocument<TopologyDefinition>
  ) {
    return definition.toString({
      collectionStyle: 'block',
    });
  }

  public buildTopologyMetadata(topology: YAMLDocument<TopologyDefinition>) {
    if (!topology.hasIn(['topology', 'links'])) {
      return {
        connections: [],
        connectionMap: new Map<string, NodeConnection[]>(),
      };
    }

    const links = (topology.getIn(['topology', 'links']) as YAMLSeq).toJS(
      topology
    );

    let index = 0;
    const connections: NodeConnection[] = [];
    const connectionMap = new Map<string, NodeConnection[]>();

    for (const link of links) {
      const [hostNode, hostInterface] = link.endpoints[0].split(':');
      const [targetNode, targetInterface] = link.endpoints[1].split(':');

      const hostNodeKind = this.editingTopology?.definition.getIn([
        'topology',
        'nodes',
        hostNode,
        'kind',
      ]) as string;

      const targetNodeKind = this.editingTopology?.definition.getIn([
        'topology',
        'nodes',
        targetNode,
        'kind',
      ]) as string;

      const hostInterfaceConfig =
        this.deviceStore.getInterfaceConfig(hostNodeKind);
      const targetInterfaceConfig =
        this.deviceStore.getInterfaceConfig(targetNodeKind);

      const hostInterfaceIndex = this.parseInterface(
        hostInterface,
        hostInterfaceConfig.interfacePattern
      );
      const targetInterfaceIndex = this.parseInterface(
        targetInterface,
        targetInterfaceConfig.interfacePattern
      );

      connections.push({
        index,
        hostNode,
        hostInterface,
        hostInterfaceIndex,
        hostInterfaceConfig,
        targetNode,
        targetInterface,
        targetInterfaceIndex,
        targetInterfaceConfig,
      });

      pushOrCreateList(connectionMap, hostNode, {
        index: index,
        hostNode: hostNode,
        hostInterface: hostInterface,
        hostInterfaceIndex: hostInterfaceIndex,
        hostInterfaceConfig: hostInterfaceConfig,
        targetNode: targetNode,
        targetInterface: targetInterface,
        targetInterfaceIndex: targetInterfaceIndex,
        targetInterfaceConfig: targetInterfaceConfig,
      });

      pushOrCreateList(connectionMap, targetNode, {
        index: index,
        hostNode: targetNode,
        hostInterface: targetInterface,
        hostInterfaceIndex: targetInterfaceIndex,
        hostInterfaceConfig: targetInterfaceConfig,
        targetNode: hostNode,
        targetInterface: hostInterface,
        targetInterfaceIndex: hostInterfaceIndex,
        targetInterfaceConfig: hostInterfaceConfig,
      });

      index++;
    }

    return {connections, connectionMap};
  }

  /**
   * Generates a valid interface ID for a given node.
   */
  private getNextInterface(nodeName: string): string {
    if (!this.editingTopology) return '';

    const deviceInfo = this.deviceStore.getInterfaceConfig(nodeName);
    const assignedNumbers = new Set(
      this.getAssignedInterfaces(
        nodeName,
        deviceInfo.interfacePattern,
        this.editingTopology.connectionMap
      )
    );
    let checkIndex = deviceInfo.interfaceStart;
    let validIndexFound = false;
    while (!validIndexFound) {
      validIndexFound = !assignedNumbers.has(checkIndex);
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
    connectionMap: Map<string, NodeConnection[]>
  ): number[] {
    return (connectionMap.get(nodeName) ?? [])
      .map(connection =>
        this.parseInterface(connection.hostInterface, interfacePattern)
      )
      .filter(index => index >= 0);
  }

  private parseInterface(value: string, interfacePattern: string): number {
    const pattern = new RegExp(interfacePattern.replaceAll('$', '(\\d+)'));
    const match = value.match(pattern);

    // console.log('VALUE:', value, 'MATCH:', match, 'PATTERN:', pattern);

    if (!match || match.length < 2) return 99;
    return Number(match[1]);
  }

  /**
   * Parses a position string to a position object. Returns null if the parsing
   * failed.
   *
   * Format: pos=[x, y]
   */
  private static readPosition(
    value: string | null | undefined
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

  private static cloneTopology(topology: Topology): Topology {
    return {
      id: topology.id,
      name: topology.name,
      collectionId: topology.collectionId,
      creator: {
        id: topology.creator.id,
        name: topology.creator.name,
      },
      connections: cloneDeep(topology.connections),
      connectionMap: cloneDeep(topology.connectionMap),
      definition: topology.definition.clone(),
      definitionString: topology.definitionString,
      gitSourceUrl: topology.gitSourceUrl,
      bindFiles: cloneDeep(topology.bindFiles),
      lastDeployFailed: topology.lastDeployFailed,
    };
  }
}
