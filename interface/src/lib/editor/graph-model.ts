import {computed} from 'mobx';

import {FileBuffer, FileEditSource} from '@sb/lib/editor/file-buffer';
import {serializeAnnotations} from '@sb/lib/format/annotations-format';
import {PastedElements} from '@sb/lib/graph/graph-clipboard';
import {nextInterface} from '@sb/lib/graph/interfaces';
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
  nodeAnnotationMap,
  NodeLayout,
  nodeLayoutAnnotation,
  readGraphNodes,
} from '@sb/lib/graph/topology-graph';
import {
  FreeShapeAnnotation,
  FreeTextAnnotation,
  GroupStyleAnnotation,
  NodeAnnotation,
  Topology,
  TopologyAnnotations,
} from '@sb/types/domain/topology';
import {
  TopologyCapabilities,
  TopologyDefinition,
} from '@sb/types/domain/topology-definition';

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

// What the graph needs of the devices to pick interfaces
export interface GraphDevices {
  readonly data: unknown;
  getInterfaceConfig(kind?: string): Parameters<typeof nextInterface>[2];
}

export interface GraphModelOptions {
  definition: FileBuffer<TopologyDefinition>;
  annotations: FileBuffer<TopologyAnnotations>;

  // What the format of the topology can store
  capabilities: TopologyCapabilities;

  // Applies a change of both files as one edit of the document
  edit: (change: () => void, mergeKey?: string) => void;

  // Whether the user can't change the topology
  isReadOnly: () => boolean;

  // The topology as saved, for the fields the graph shows that aren't in the files
  savedTopology: () => Topology | undefined;

  devices: GraphDevices;
}

/**
 * The graph of a topology: its definition and annotations as the graph reads
 * them, and the edits the graph makes. The graph component draws it. An edit is one change of the document,
 * also when it changes both files.
 */
export class GraphModel {
  public readonly capabilities: TopologyCapabilities;

  private readonly definitionBuffer: FileBuffer<TopologyDefinition>;
  private readonly annotationsBuffer: FileBuffer<TopologyAnnotations>;
  private readonly documentEdit: GraphModelOptions['edit'];
  private readonly readOnly: () => boolean;
  private readonly savedTopology: () => Topology | undefined;
  private readonly deviceStore: GraphDevices;

  constructor(options: GraphModelOptions) {
    this.definitionBuffer = options.definition;
    this.annotationsBuffer = options.annotations;
    this.capabilities = options.capabilities;
    this.documentEdit = options.edit;
    this.readOnly = options.isReadOnly;
    this.savedTopology = options.savedTopology;
    this.deviceStore = options.devices;
  }

  public get isReadOnly(): boolean {
    return this.readOnly();
  }

  /**
   * The topology the graph shows: the saved topology with the definition and
   * annotations of the files. Null until the definition could be read once.
   */
  @computed
  public get topology(): Topology | null {
    const saved = this.savedTopology();
    const definition = this.definitionBuffer.value;
    if (!saved || !definition) return null;

    return {
      ...saved,
      definition,
      annotations: this.annotationsBuffer.value ?? {},
    };
  }

  /**
   * Replaces the definition, and the annotations in the same edit if the change
   * affects both. The graph-* labels are converted to annotations, legacy groups
   * to group annotations, and new nodes are placed.
   */
  public edit(
    updatedDefinition: TopologyDefinition,
    updatedAnnotations?: TopologyAnnotations,
    mergeKey?: string,
  ) {
    const current = this.current;
    if (!current || this.isReadOnly) return;

    let definition = updatedDefinition;
    let annotations = updatedAnnotations ?? current.annotations;

    const converted = convertGraphLabels(definition, annotations);
    if (converted) {
      definition = converted.definition;
      annotations = converted.annotations;
    }

    const placed = this.placeNodeAnnotations(definition, annotations);
    this.apply(definition, convertLegacyGroups(placed) ?? placed, mergeKey);
  }

  /**
   * Replaces the annotations, converted like in edit().
   */
  public editAnnotations(
    updatedAnnotations: TopologyAnnotations,
    mergeKey?: string,
  ) {
    const current = this.current;
    if (!current || this.isReadOnly) return;

    const converted = convertGraphLabels(
      current.definition,
      updatedAnnotations,
    );
    if (converted) {
      this.edit(converted.definition, converted.annotations, mergeKey);
      return;
    }

    const placed = this.placeNodeAnnotations(
      current.definition,
      updatedAnnotations,
    );
    this.apply(null, convertLegacyGroups(placed) ?? placed, mergeKey);
  }

  /**
   * Deletes all nodes and links.
   */
  public clear() {
    const current = this.current;
    if (!current || this.isReadOnly) return;

    const {definition} = current;
    this.apply(
      definition
        .deleteLinks(definition.links.map(link => link.index))
        .deleteNodes(definition.nodeNames),
      removeNodeAnnotations(current.annotations, definition.nodeNames),
    );
  }

  /**
   * Completes the layout before the topology is saved, so a saved topology
   * always stores the positions of all of its nodes in the annotations, also
   * if it was never changed in the graph:
   *
   * - The graph-* labels are converted to annotations.
   * - Nodes without a position are saved where the graph shows them.
   * - Groups referenced by name get a group annotation.
   * - Annotations of nodes that were removed in the text editor are removed.
   *
   * The changes are a regular edit, so the text editor shows them and they can
   * be undone.
   */
  public completeLayout() {
    const current = this.current;
    if (!current) return;

    const converted = convertGraphLabels(
      current.definition,
      current.annotations,
    );
    const definition = converted?.definition ?? current.definition;
    const placed = this.placeNodeAnnotations(
      definition,
      converted?.annotations ?? current.annotations,
    );
    const completed = removeOrphanedNodeAnnotations(
      definition,
      convertLegacyGroups(placed) ?? placed,
    );

    const isDefinitionChanged = definition !== current.definition;
    const isAnnotationsChanged =
      serializeAnnotations(completed) !==
      serializeAnnotations(current.annotations);
    if (!isDefinitionChanged && !isAnnotationsChanged) return;

    this.apply(
      isDefinitionChanged ? definition : null,
      isAnnotationsChanged ? completed : null,
    );
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
    const current = this.current;
    if (!current) return null;

    const textId = nextAnnotationId(
      current.annotations,
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
    const current = this.current;
    if (!current) return;

    const updatedTopology = current.definition.addNodes(
      pasted.nodes,
      pasted.links,
      pasted.names,
    );

    const annotations = current.annotations;
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

    this.edit(updatedTopology, updatedAnnotations);
  }

  /**
   * Deletes the given nodes, links, groups, shapes and texts in one edit. The
   * members of a deleted group are only deleted if they are given as well.
   *
   * @param nodeNames The names of the nodes to delete.
   * @param linkIndices The links to delete by their position in the topology.
   * @param groupIds The IDs of the groups to delete.
   * @param annotationIds The IDs of the shapes and texts to delete.
   */
  public deleteElements(
    nodeNames: string[],
    linkIndices: number[],
    groupIds: string[],
    annotationIds: string[],
  ) {
    const current = this.current;
    if (!current) return;

    // The links of deleted nodes are deleted with them
    const {definition} = current;
    const updatedTopology = definition
      .deleteLinks(linkIndices)
      .deleteNodes(nodeNames);

    const annotations = (
      ['freeShapeAnnotations', 'freeTextAnnotations'] as const
    ).reduce(
      (updated, key) => removeAnnotationItems(updated, key, annotationIds),
      removeNodeAnnotations(
        removeGroupAnnotations(current.annotations, groupIds),
        nodeNames,
      ),
    );

    this.edit(updatedTopology, annotations);
  }

  /**
   * Renames a node, its links and its annotation follow the new name.
   */
  public renameNode(nodeName: string, updatedNodeName: string) {
    const current = this.current;
    if (!current || nodeName === updatedNodeName) return;

    this.edit(
      current.definition.renameNode(nodeName, updatedNodeName),
      renameNodeAnnotation(current.annotations, nodeName, updatedNodeName),
    );
  }

  /**
   * Renames the interface at one end of a link.
   *
   * @param linkIndex The index of the link in the topology.
   * @param endpointIndex The end of the link, 0 for the first endpoint.
   * @param interfaceName The new name of the interface.
   */
  public renameInterface(
    linkIndex: number,
    endpointIndex: number,
    interfaceName: string,
  ) {
    const current = this.current;
    if (!current) return;

    this.edit(
      current.definition.renameInterface(
        linkIndex,
        endpointIndex,
        interfaceName,
      ),
    );
  }

  /**
   * Connects two nodes in the topology.
   *
   * @param nodeName1 The name of the first node to connect.
   * @param nodeName2 The name of the second node to connect.
   */
  public connectNodes(nodeName1: string, nodeName2: string) {
    const current = this.current;
    if (!current || !this.deviceStore.data) return;

    // Each end gets the next free interface in the pattern of the node's device.
    // A link from a node to itself needs two different ones.
    const {definition} = current;
    const freeInterface = (nodeName: string, taken: string[] = []) =>
      nextInterface(
        definition,
        nodeName,
        this.deviceStore.getInterfaceConfig(
          definition.nodes.get(nodeName)?.device,
        ),
        taken,
      );

    const interface1 = freeInterface(nodeName1);
    const interface2 = freeInterface(
      nodeName2,
      nodeName1 === nodeName2 ? [interface1] : [],
    );

    const updatedTopology = definition.connect([
      {node: nodeName1, interface: interface1},
      {node: nodeName2, interface: interface2},
    ]);

    this.edit(updatedTopology);
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
    const current = this.current;
    if (!current) return;

    const converted = convertGraphLabels(
      current.definition,
      current.annotations,
    );
    const definition = converted?.definition ?? current.definition;
    const placedAnnotations = this.placeNodeAnnotations(
      definition,
      converted?.annotations ?? current.annotations,
    );
    const updatedAnnotations = change(
      convertLegacyGroups(placedAnnotations) ?? placedAnnotations,
    );

    if (converted) {
      this.edit(definition, updatedAnnotations, mergeKey);
    } else {
      this.editAnnotations(updatedAnnotations, mergeKey);
    }
  }

  /**
   * Writes positions to the annotations for the nodes of the updated topology that
   * don't have one. Nodes keep the position they are currently shown at in the
   * graph, all others are placed in the updated topology.
   */
  private placeNodeAnnotations(
    updatedTopology: TopologyDefinition,
    updatedAnnotations: TopologyAnnotations,
  ): TopologyAnnotations {
    const unplacedNodes = readGraphNodes(updatedTopology, updatedAnnotations)
      .filter(node => !node.position)
      .map(node => node.name);
    if (unplacedNodes.length === 0) return updatedAnnotations;

    const shownPositions = placeNodes(
      this.current!.definition,
      this.current!.annotations,
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
    )) {
      placedUpdates.set(nodeName, {position});
    }

    annotations = updateNodeAnnotations(annotations, placedUpdates);
    return annotations;
  }

  // The definition and annotations as the graph reads them, null if the definition was never valid
  private get current(): {
    definition: TopologyDefinition;
    annotations: TopologyAnnotations;
  } | null {
    const definition = this.definitionBuffer.value;
    if (!definition) return null;

    return {definition, annotations: this.annotationsBuffer.value ?? {}};
  }

  private apply(
    definition: TopologyDefinition | null,
    annotations: TopologyAnnotations | null,
    mergeKey?: string,
  ) {
    this.documentEdit(() => {
      if (definition) {
        this.definitionBuffer.setValue(definition, FileEditSource.Structured);
      }
      if (annotations) {
        this.annotationsBuffer.setValue(annotations, FileEditSource.Structured);
      }
    }, mergeKey);
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
