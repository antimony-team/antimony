import {cloneDeep} from 'lodash-es';
import {runInAction} from 'mobx';
import {YAMLSeq} from 'yaml';

import {PastedElements} from '@sb/lib/graph/graph-clipboard';
import {placeNodes} from '@sb/lib/graph/placement';
import {
  addAnnotationItem,
  AnnotationListKey,
  convertGraphLabels,
  convertLegacyGroups,
  frontZIndex,
  groupParentUpdate,
  nextAnnotationId,
  removeAnnotationItems,
  removeGroupAnnotations,
  removeNodeAnnotations,
  removeOrphanedNodeAnnotations,
  renameNodeAnnotation,
  reorderAnnotationItems,
  stepLayerItems,
  updateAnnotationItems,
  updateNodeAnnotations,
} from '@sb/lib/graph/topology-annotations';
import {
  buildTopologyMetadata,
  nodeAnnotationMap,
  NodeLayout,
  nodeLayoutAnnotation,
  parseInterface,
  readGraphNodes,
  renameNodeInDefinition,
} from '@sb/lib/graph/topology-graph';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {Binding} from '@sb/lib/utils/binding';
import {
  BindFile,
  FreeShapeAnnotation,
  FreeTextAnnotation,
  GroupStyleAnnotation,
  NodeAnnotation,
  NodeConnection,
  Topology,
  TopologyAnnotations,
  TopologyDefinition,
  TopologyIn,
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

  // Consecutive edits with the same key are undone in one step, e.g. nudging
  mergeKey?: string;
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

/**
 * A change of the layout of the graph, applied as one edit.
 */
export interface GraphLayoutUpdate {
  // The layout of the changed nodes by node name
  nodes?: Map<string, NodeLayout>;

  // The changed fields of groups by group ID
  groups?: Map<string, Partial<GroupStyleAnnotation>>;

  // The changed fields of shapes by shape ID
  shapes?: Map<string, Partial<FreeShapeAnnotation>>;

  // The changed fields of texts by text ID
  texts?: Map<string, Partial<FreeTextAnnotation>>;
}

// The annotation lists that are drawn below the nodes in one order
const LAYER_ANNOTATION_KEYS: AnnotationListKey[] = [
  'groupStyleAnnotations',
  'freeShapeAnnotations',
];

export enum OpenFileType {
  Topology,
  BindFile,
}

export class TopologyManager {
  // Serialized definitions and annotations by object. Edits always replace these
  // objects instead of changing them, so a serialized value stays valid.
  private static readonly serializedDefinitions = new WeakMap<
    YAMLDocument<TopologyDefinition>,
    string
  >();
  private static readonly serializedAnnotations = new WeakMap<
    TopologyAnnotations,
    string
  >();

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
    let serialized = TopologyManager.serializedDefinitions.get(definition);

    if (serialized === undefined) {
      serialized = definition.toString({collectionStyle: 'block'});
      TopologyManager.serializedDefinitions.set(definition, serialized);
    }

    return serialized;
  }

  public static serializeAnnotations(annotations: TopologyAnnotations) {
    let serialized = TopologyManager.serializedAnnotations.get(annotations);

    if (serialized === undefined) {
      serialized = JSON.stringify(annotations, null, 2);
      TopologyManager.serializedAnnotations.set(annotations, serialized);
    }

    return serialized;
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
      annotations: cloneDeep(topology.annotations),
      annotationsString: topology.annotationsString,
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

  /**
   * Writes the layout of the given nodes and groups to the annotations.
   *
   * @param update The changed layout.
   * @param mergeKey Merges the edit with the edit right before in the history.
   */
  public updateLayout(update: GraphLayoutUpdate, mergeKey?: string) {
    this.editGraphAnnotations(
      annotations => applyLayoutUpdate(annotations, update),
      mergeKey,
    );
  }

  /**
   * Adds a group, nested in the given parent group. Returns the ID of the group.
   *
   * @param group The fields of the group.
   * @param update The layout changed with the group, e.g. its new members, which
   * is written in the same edit.
   */
  public addGroup(
    group: Pick<GroupStyleAnnotation, 'name' | 'position' | 'width' | 'height'>,
    parentId: string | null,
    update: (groupId: string) => GraphLayoutUpdate,
  ): string | null {
    let groupId: string | null = null;

    this.editGraphAnnotations(annotations => {
      groupId = nextAnnotationId(annotations, 'groupStyleAnnotations', 'group');

      return applyLayoutUpdate(
        addAnnotationItem(annotations, 'groupStyleAnnotations', {
          ...group,
          ...groupParentUpdate(parentId),
          id: groupId,
          level: '1',
        }),
        update(groupId),
      );
    });

    return groupId;
  }

  /**
   * Removes the given groups, their members are kept.
   */
  public removeGroups(groupIds: string[]) {
    if (groupIds.length === 0) return;

    this.editGraphAnnotations(annotations =>
      removeGroupAnnotations(annotations, groupIds),
    );
  }

  /**
   * Adds a shape in front of all groups and shapes. Returns the ID of the shape.
   */
  public addShape(
    shape: Pick<FreeShapeAnnotation, 'shapeType' | 'position'> &
      Partial<FreeShapeAnnotation>,
  ): string | null {
    let shapeId: string | null = null;

    this.editGraphAnnotations(annotations => {
      shapeId = nextAnnotationId(annotations, 'freeShapeAnnotations', 'shape');

      return addAnnotationItem(annotations, 'freeShapeAnnotations', {
        ...shape,
        id: shapeId,
        zIndex: frontZIndex(annotations, LAYER_ANNOTATION_KEYS),
      });
    });

    return shapeId;
  }

  /**
   * Adds a text in front of all texts. Returns the ID of the text.
   *
   * Changes of the text right after merge with this edit, so placing a text
   * and writing it is one edit in the history.
   */
  public addText(
    text: Pick<FreeTextAnnotation, 'text' | 'position'> &
      Partial<FreeTextAnnotation>,
  ): string | null {
    if (!this.editingTopology) return null;

    const textId = nextAnnotationId(
      this.editingTopology.annotations,
      'freeTextAnnotations',
      'text',
    );

    this.editGraphAnnotations(
      annotations =>
        addAnnotationItem(annotations, 'freeTextAnnotations', {
          ...text,
          id: textId,
          zIndex: frontZIndex(annotations, ['freeTextAnnotations']),
        }),
      textMergeKey(textId),
    );

    return textId;
  }

  /**
   * Changes the markdown of a text, a text without any is removed. Consecutive
   * changes of the same text are one edit in the history.
   */
  public setText(textId: string, text: string) {
    this.editGraphAnnotations(
      annotations =>
        text.trim() === ''
          ? removeAnnotationItems(annotations, 'freeTextAnnotations', [textId])
          : updateAnnotationItems(
              annotations,
              'freeTextAnnotations',
              new Map([[textId, {text}]]),
            ),
      textMergeKey(textId),
    );
  }

  /**
   * Draws the given annotations in front of or behind all other annotations.
   * Groups and shapes share one order below the nodes, texts have their own
   * above the nodes.
   */
  public reorderAnnotations(ids: string[], toFront: boolean) {
    if (ids.length === 0) return;

    this.editGraphAnnotations(annotations =>
      reorderAnnotationItems(annotations, LAYER_ANNOTATION_KEYS, ids, toFront),
    );
  }

  /**
   * Moves the given groups and shapes one step forward or backward, past the
   * next group or shape they overlap.
   */
  public stepAnnotations(ids: string[], isForward: boolean) {
    if (ids.length === 0) return;

    this.editGraphAnnotations(annotations =>
      stepLayerItems(annotations, ids, isForward),
    );
  }

  /**
   * Adds pasted elements in one edit. Groups and shapes are placed in front of
   * all others and texts in front of all texts, in the order they were in.
   */
  public pasteElements(pasted: PastedElements) {
    if (!this.editingTopology) return;

    const updatedTopology = this.editingTopology.definition.clone();

    for (const node of pasted.nodes) {
      updatedTopology.setIn(['topology', 'nodes', node.name], node.definition);
    }

    if (pasted.links.length > 0) {
      if (!updatedTopology.hasIn(['topology', 'links'])) {
        updatedTopology.setIn(['topology', 'links'], new YAMLSeq());
      }

      const links = updatedTopology.getIn(['topology', 'links']) as YAMLSeq;
      pasted.links.forEach(link => links.add(updatedTopology.createNode(link)));
    }

    const annotations = this.editingTopology.annotations;
    const layerZIndex = frontZIndex(annotations, LAYER_ANNOTATION_KEYS);
    const textZIndex = frontZIndex(annotations, ['freeTextAnnotations']);

    const layered = [...pasted.groups, ...pasted.shapes].toSorted(
      (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
    );
    const zIndices = new Map(
      layered.map((item, index) => [item, layerZIndex + index]),
    );

    let updatedAnnotations = updateNodeAnnotations(
      annotations,
      new Map(pasted.nodes.map(node => [node.name, node.annotation])),
    );

    for (const group of pasted.groups) {
      updatedAnnotations = addAnnotationItem(
        updatedAnnotations,
        'groupStyleAnnotations',
        {...group, zIndex: zIndices.get(group)},
      );
    }

    for (const shape of pasted.shapes) {
      updatedAnnotations = addAnnotationItem(
        updatedAnnotations,
        'freeShapeAnnotations',
        {...shape, zIndex: zIndices.get(shape)},
      );
    }

    pasted.texts
      .toSorted((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
      .forEach((text, index) => {
        updatedAnnotations = addAnnotationItem(
          updatedAnnotations,
          'freeTextAnnotations',
          {...text, zIndex: textZIndex + index},
        );
      });

    this.editTopology(
      updatedTopology,
      TopologyEditSource.NodeEditor,
      updatedAnnotations,
    );
  }

  /**
   * Deletes the given nodes, links, groups, shapes and texts in one edit. The
   * members of a deleted group are only deleted if they are given as well.
   *
   * @param nodeNames The names of the nodes to delete.
   * @param links The links to delete by the names of their two nodes.
   * @param groupIds The IDs of the groups to delete.
   * @param annotationIds The IDs of the shapes and texts to delete.
   */
  public deleteElements(
    nodeNames: string[],
    links: [string, string][],
    groupIds: string[],
    annotationIds: string[],
  ) {
    if (!this.editingTopology) return;

    const updatedTopology = this.editingTopology.definition.clone();
    const deletedNodes = new Set(nodeNames);

    for (const nodeName of nodeNames) {
      updatedTopology.deleteIn(['topology', 'nodes', nodeName]);
    }

    const linkSeq = updatedTopology.getIn(['topology', 'links']);
    if (linkSeq instanceof YAMLSeq) {
      const remainingLinks = [...links];

      for (let index = linkSeq.items.length - 1; index >= 0; index--) {
        const endpoints = (
          updatedTopology.getIn(['topology', 'links', index, 'endpoints']) as
            | YAMLSeq
            | undefined
        )?.toJS(updatedTopology) as string[] | undefined;
        if (!endpoints || endpoints.length < 2) continue;

        const node1 = endpoints[0].split(':')[0];
        const node2 = endpoints[1].split(':')[0];
        const linkIndex = remainingLinks.findIndex(
          ([a, b]) => a === node1 && b === node2,
        );

        if (linkIndex !== -1) {
          remainingLinks.splice(linkIndex, 1);
          linkSeq.delete(index);
        } else if (deletedNodes.has(node1) || deletedNodes.has(node2)) {
          linkSeq.delete(index);
        }
      }
    }

    const annotations = (
      ['freeShapeAnnotations', 'freeTextAnnotations'] as const
    ).reduce(
      (updated, key) => removeAnnotationItems(updated, key, annotationIds),
      removeNodeAnnotations(
        removeGroupAnnotations(this.editingTopology.annotations, groupIds),
        nodeNames,
      ),
    );

    this.editTopology(
      updatedTopology,
      TopologyEditSource.NodeEditor,
      annotations,
    );
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

  /**
   * Replaces the definition of the topology, and optionally its annotations in
   * the same edit if the change affects both.
   */
  public editTopology(
    updatedTopology: YAMLDocument<TopologyDefinition>,
    source: TopologyEditSource,
    updatedAnnotations?: TopologyAnnotations,
    mergeKey?: string,
  ) {
    if (!this.editingTopology) return;

    // The graph-* labels are converted to annotations on the first edit in the graph
    if (source === TopologyEditSource.NodeEditor) {
      const converted = convertGraphLabels(
        updatedTopology,
        updatedAnnotations ?? this.editingTopology.annotations,
      );

      if (converted) {
        updatedTopology = converted.definition;
        updatedAnnotations = converted.annotations;
      }
    }

    const topologyMeta = buildTopologyMetadata(updatedTopology, kind =>
      this.deviceStore.getInterfaceConfig(kind),
    );

    if (source === TopologyEditSource.NodeEditor) {
      const placedAnnotations = this.placeNodeAnnotations(
        updatedTopology,
        updatedAnnotations ?? this.editingTopology.annotations,
        topologyMeta.connections,
      );
      updatedAnnotations =
        convertLegacyGroups(placedAnnotations) ?? placedAnnotations;
    }

    runInAction(() => {
      this.editingTopology!.definition = updatedTopology;
      this.editingTopology!.nodeCount = topologyMeta.nodeCount;
      this.editingTopology!.connections = topologyMeta.connections;
      this.editingTopology!.connectionMap = topologyMeta.connectionMap;

      if (updatedAnnotations) {
        this.editingTopology!.annotations = updatedAnnotations;
      }
    });

    this.onTopologyEdit.update({
      updatedTopology: this.editingTopology,
      isEdited: this.isTopologyEdited(),
      source,
      mergeKey,
    });
  }

  public editAnnotations(
    updatedAnnotations: TopologyAnnotations,
    source: TopologyEditSource,
    mergeKey?: string,
  ) {
    if (!this.editingTopology) return;

    if (source === TopologyEditSource.NodeEditor) {
      const converted = convertGraphLabels(
        this.editingTopology.definition,
        updatedAnnotations,
      );

      if (converted) {
        this.editTopology(
          converted.definition,
          source,
          converted.annotations,
          mergeKey,
        );
        return;
      }

      const placedAnnotations = this.placeNodeAnnotations(
        this.editingTopology.definition,
        updatedAnnotations,
        this.editingTopology.connections,
      );
      updatedAnnotations =
        convertLegacyGroups(placedAnnotations) ?? placedAnnotations;
    }

    runInAction(() => {
      this.editingTopology!.annotations = updatedAnnotations;
    });

    this.onTopologyEdit.update({
      updatedTopology: this.editingTopology,
      isEdited: this.isTopologyEdited(),
      source,
      mergeKey,
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

      const nodeNames = Object.keys(
        this.editingTopology.definition.toJS().topology?.nodes ?? {},
      );

      this.editTopology(
        new YAMLDocument(updatedTopology),
        TopologyEditSource.System,
        removeNodeAnnotations(this.editingTopology.annotations, nodeNames),
      );
    } else if (this.openFileType === OpenFileType.BindFile) {
      if (!this.editingBindFile) return;

      this.editBindFile('', BindFileEditSource.System);
    }
  }

  /**
   * Renames a node, its links and its annotation follow the new name.
   */
  public renameNode(nodeName: string, updatedNodeName: string) {
    if (!this.editingTopology || nodeName === updatedNodeName) return;

    const updatedTopology = this.editingTopology.definition.clone();
    renameNodeInDefinition(updatedTopology, nodeName, updatedNodeName);

    this.editTopology(
      updatedTopology,
      TopologyEditSource.NodeEditor,
      renameNodeAnnotation(
        this.editingTopology.annotations,
        nodeName,
        updatedNodeName,
      ),
    );
  }

  /**
   * Renames the interface at one end of a link.
   *
   * @param linkIndex The index of the link in the topology.
   * @param endpointIndex The end of the link, 0 for the first endpoint.
   * @param nodeName The node at that end of the link.
   * @param interfaceName The new name of the interface.
   */
  public renameInterface(
    linkIndex: number,
    endpointIndex: number,
    nodeName: string,
    interfaceName: string,
  ) {
    if (!this.editingTopology) return;

    const updatedTopology = this.editingTopology.definition.clone();
    updatedTopology.setIn(
      ['topology', 'links', linkIndex, 'endpoints', endpointIndex],
      `${nodeName}:${interfaceName}`,
    );

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

  /**
   * Returns whether the currently open topology has been edited.
   *
   * Edit means that the editing topology has been changed, but these changes
   * have not yet been saved and synced with the server.
   */
  public hasEdits() {
    if (this.openFileType === OpenFileType.Topology) {
      return this.isTopologyEdited();
    } else {
      if (!this.editingBindFile || !this.originalBindFile) return false;

      return this.editingBindFile.content !== this.originalBindFile.content;
    }
  }

  /**
   * Saves the open topology. Before it is saved, its layout is completed, so a
   * saved topology always stores the positions of all of its nodes in the
   * annotations, also if it was never changed in the graph:
   *
   * - The graph-* labels are converted to annotations.
   * - Nodes without a position are saved where the graph shows them.
   * - Groups referenced by name get a group annotation.
   * - Annotations of nodes that were removed in the text editor are removed.
   *
   * These changes are applied as a regular edit before the topology is sent, so
   * the text editor shows them and they can be undone.
   */
  private async saveTopology(): Promise<Result<DataResponse<void>> | null> {
    if (!this.editingTopology) return null;

    const converted = convertGraphLabels(
      this.editingTopology.definition,
      this.editingTopology.annotations,
    );
    const definition = converted?.definition ?? this.editingTopology.definition;
    const placedAnnotations = this.placeNodeAnnotations(
      definition,
      converted?.annotations ?? this.editingTopology.annotations,
      this.editingTopology.connections,
    );
    const completedAnnotations = removeOrphanedNodeAnnotations(
      definition,
      convertLegacyGroups(placedAnnotations) ?? placedAnnotations,
    );

    if (definition !== this.editingTopology.definition) {
      this.editTopology(
        definition,
        TopologyEditSource.System,
        completedAnnotations,
      );
    } else if (completedAnnotations !== this.editingTopology.annotations) {
      this.editAnnotations(completedAnnotations, TopologyEditSource.System);
    }

    const body: Partial<TopologyIn> = {
      definition: TopologyManager.serializeTopology(
        this.editingTopology.definition,
      ),
    };

    const annotations = TopologyManager.serializeAnnotations(
      this.editingTopology.annotations,
    );

    if (
      !this.originalTopology ||
      annotations !==
        TopologyManager.serializeAnnotations(this.originalTopology.annotations)
    ) {
      body.annotations = annotations;
    }

    const result = await this.topologyStore.update(
      this.editingTopology.id,
      body,
    );

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
   * Applies a change of the annotations as an edit from the graph. The change
   * gets the annotations with the legacy layout already converted, so it can
   * refer to legacy groups by their ID and its result isn't overwritten by them.
   */
  private editGraphAnnotations(
    change: (annotations: TopologyAnnotations) => TopologyAnnotations,
    mergeKey?: string,
  ) {
    if (!this.editingTopology) return;

    const converted = convertGraphLabels(
      this.editingTopology.definition,
      this.editingTopology.annotations,
    );
    const definition = converted?.definition ?? this.editingTopology.definition;
    const placedAnnotations = this.placeNodeAnnotations(
      definition,
      converted?.annotations ?? this.editingTopology.annotations,
      this.editingTopology.connections,
    );
    const updatedAnnotations = change(
      convertLegacyGroups(placedAnnotations) ?? placedAnnotations,
    );

    if (converted) {
      this.editTopology(
        definition,
        TopologyEditSource.NodeEditor,
        updatedAnnotations,
        mergeKey,
      );
    } else {
      this.editAnnotations(
        updatedAnnotations,
        TopologyEditSource.NodeEditor,
        mergeKey,
      );
    }
  }

  /**
   * Writes positions to the annotations for the nodes of the updated topology that
   * don't have one. Nodes keep the position they are currently shown at in the
   * graph, all others are placed in the updated topology.
   */
  private placeNodeAnnotations(
    updatedTopology: YAMLDocument<TopologyDefinition>,
    updatedAnnotations: TopologyAnnotations,
    connections: NodeConnection[],
  ): TopologyAnnotations {
    const unplacedNodes = readGraphNodes(updatedTopology, updatedAnnotations)
      .filter(node => !node.position)
      .map(node => node.name);
    if (unplacedNodes.length === 0) return updatedAnnotations;

    const shownPositions = placeNodes(
      this.editingTopology!.definition,
      this.editingTopology!.annotations,
      this.editingTopology!.connections,
    );

    const shownUpdates = new Map<string, Partial<NodeAnnotation>>();
    for (const nodeName of unplacedNodes) {
      const position = shownPositions.get(nodeName);
      if (position) shownUpdates.set(nodeName, {position});
    }

    let annotations =
      shownUpdates.size > 0
        ? updateNodeAnnotations(updatedAnnotations, shownUpdates)
        : updatedAnnotations;
    if (shownUpdates.size === unplacedNodes.length) return annotations;

    const placedUpdates = new Map<string, Partial<NodeAnnotation>>();
    for (const [nodeName, position] of placeNodes(
      updatedTopology,
      annotations,
      connections,
    )) {
      placedUpdates.set(nodeName, {position});
    }

    annotations = updateNodeAnnotations(annotations, placedUpdates);
    return annotations;
  }

  private isTopologyEdited() {
    if (!this.editingTopology || !this.originalTopology) return false;

    return (
      TopologyManager.serializeTopology(this.editingTopology.definition) !==
        TopologyManager.serializeTopology(this.originalTopology.definition) ||
      TopologyManager.serializeAnnotations(this.editingTopology.annotations) !==
        TopologyManager.serializeAnnotations(this.originalTopology.annotations)
    );
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

function textMergeKey(textId: string) {
  return `text-${textId}`;
}

/**
 * Writes the layout of the given nodes, groups, shapes and texts to the
 * annotations.
 */
function applyLayoutUpdate(
  annotations: TopologyAnnotations,
  update: GraphLayoutUpdate,
): TopologyAnnotations {
  let updatedAnnotations = annotations;

  if (update.nodes) {
    const nodeAnnotations = nodeAnnotationMap(annotations);
    const annotationUpdates = new Map<string, Partial<NodeAnnotation>>();

    for (const [nodeName, layout] of update.nodes) {
      annotationUpdates.set(
        nodeName,
        nodeLayoutAnnotation(nodeAnnotations.get(nodeName), layout),
      );
    }

    updatedAnnotations = updateNodeAnnotations(
      updatedAnnotations,
      annotationUpdates,
    );
  }

  if (update.groups) {
    updatedAnnotations = updateAnnotationItems(
      updatedAnnotations,
      'groupStyleAnnotations',
      update.groups,
    );
  }

  if (update.shapes) {
    updatedAnnotations = updateAnnotationItems(
      updatedAnnotations,
      'freeShapeAnnotations',
      update.shapes,
    );
  }

  if (update.texts) {
    updatedAnnotations = updateAnnotationItems(
      updatedAnnotations,
      'freeTextAnnotations',
      update.texts,
    );
  }

  return updatedAnnotations;
}
