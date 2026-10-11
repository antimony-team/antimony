import {isMap, isScalar} from 'yaml';

import {groupBoxAround, nodeGroupId} from '@sb/lib/graph/annotation-geometry';
import {
  convertLatLngToXY,
  GRAPH_LABELS,
  labelsToAnnotation,
} from '@sb/lib/graph/topology-graph';
import {
  NodeAnnotation,
  NodeLabels,
  TopologyAnnotations,
  TopologyDefinition,
} from '@sb/types/domain/topology';
import {Position, YAMLDocument} from '@sb/types/types';

/*
 * These functions return updated copies of the annotations and leave the given
 * annotations untouched, so they can be compared against the original.
 */

export function findNodeAnnotation(
  annotations: TopologyAnnotations,
  nodeName: string,
): NodeAnnotation | undefined {
  return annotations.nodeAnnotations?.find(
    annotation => annotation.id === nodeName,
  );
}

/**
 * Merges the given fields into the annotations of the nodes, nodes without an
 * annotation get a new one. Fields that are set to undefined are removed.
 *
 * @param annotations The annotations to update.
 * @param updates The fields to set by node name.
 */
export function updateNodeAnnotations(
  annotations: TopologyAnnotations,
  updates: Map<string, Partial<NodeAnnotation>>,
): TopologyAnnotations {
  const pendingUpdates = new Map(updates);

  const nodeAnnotations = (annotations.nodeAnnotations ?? []).map(
    annotation => {
      const update = pendingUpdates.get(annotation.id);
      if (!update) return annotation;

      pendingUpdates.delete(annotation.id);
      return mergeAnnotation(annotation, update);
    },
  );

  for (const [nodeName, update] of pendingUpdates) {
    nodeAnnotations.push(mergeAnnotation({id: nodeName}, update));
  }

  return {...annotations, nodeAnnotations};
}

// The annotation lists whose items are identified by an ID of their own
export type AnnotationListKey =
  | 'freeTextAnnotations'
  | 'freeShapeAnnotations'
  | 'groupStyleAnnotations';

type AnnotationItem<K extends AnnotationListKey> = NonNullable<
  TopologyAnnotations[K]
>[number];

/**
 * Returns an ID with the given prefix that no item of the list uses yet.
 */
export function nextAnnotationId(
  annotations: TopologyAnnotations,
  key: AnnotationListKey,
  prefix: string,
): string {
  const ids = new Set((annotations[key] ?? []).map(item => item.id));

  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index++;

  return `${prefix}-${index}`;
}

export function addAnnotationItem<K extends AnnotationListKey>(
  annotations: TopologyAnnotations,
  key: K,
  item: AnnotationItem<K>,
): TopologyAnnotations {
  return {...annotations, [key]: [...(annotations[key] ?? []), item]};
}

/**
 * Merges the given fields into the items of the list. Fields that are set to
 * undefined are removed.
 *
 * @param annotations The annotations to update.
 * @param key The list to update.
 * @param updates The fields to set by item ID.
 */
export function updateAnnotationItems<K extends AnnotationListKey>(
  annotations: TopologyAnnotations,
  key: K,
  updates: Map<string, Partial<AnnotationItem<K>>>,
): TopologyAnnotations {
  if (!annotations[key]) return annotations;

  return {
    ...annotations,
    [key]: (annotations[key] as AnnotationItem<K>[]).map(item => {
      const update = updates.get(item.id);
      return update ? mergeAnnotation(item, update) : item;
    }),
  };
}

export function removeAnnotationItems(
  annotations: TopologyAnnotations,
  key: AnnotationListKey,
  ids: string[],
): TopologyAnnotations {
  if (!annotations[key]) return annotations;

  const removedIds = new Set(ids);

  return {
    ...annotations,
    [key]: annotations[key].filter(item => !removedIds.has(item.id)),
  };
}

/**
 * Brings the given items of the list in front of all other items of the list,
 * or behind them. The order between the given items is kept.
 */
export function reorderAnnotationItems(
  annotations: TopologyAnnotations,
  key: AnnotationListKey,
  ids: string[],
  toFront: boolean,
): TopologyAnnotations {
  const items = annotations[key] ?? [];
  const movedIds = new Set(ids);
  const moved = items.filter(item => movedIds.has(item.id));
  const others = items.filter(item => !movedIds.has(item.id));
  if (moved.length === 0) return annotations;

  const zIndices = others.map(item => item.zIndex ?? 0);
  const sortedMoved = moved.toSorted(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
  );
  const start = toFront
    ? Math.max(0, ...zIndices) + 1
    : Math.min(0, ...zIndices) - sortedMoved.length;

  const updates = new Map(
    sortedMoved.map((item, index) => [item.id, {zIndex: start + index}]),
  );

  return updateAnnotationItems(annotations, key, updates);
}

/**
 * Removes the given groups and the membership of all nodes and annotations in
 * them. The members themselves are kept.
 */
export function removeGroupAnnotations(
  annotations: TopologyAnnotations,
  groupIds: string[],
): TopologyAnnotations {
  const removedIds = new Set(groupIds);
  const isRemoved = (groupId?: string) =>
    groupId !== undefined && removedIds.has(groupId);

  const updated = removeAnnotationItems(
    annotations,
    'groupStyleAnnotations',
    groupIds,
  );

  const memberUpdates = new Map<string, Partial<NodeAnnotation>>();
  for (const annotation of annotations.nodeAnnotations ?? []) {
    if (isRemoved(annotation.groupId)) {
      memberUpdates.set(annotation.id, {
        groupId: undefined,
        group: undefined,
        level: undefined,
      });
    }
  }

  let result =
    memberUpdates.size > 0
      ? updateNodeAnnotations(updated, memberUpdates)
      : updated;

  for (const key of ['freeTextAnnotations', 'freeShapeAnnotations'] as const) {
    const ids = (result[key] ?? [])
      .filter(item => isRemoved(item.groupId))
      .map(item => item.id);

    if (ids.length > 0) {
      result = updateAnnotationItems(
        result,
        key,
        new Map(ids.map(id => [id, {groupId: undefined}])),
      );
    }
  }

  return result;
}

export function renameNodeAnnotation(
  annotations: TopologyAnnotations,
  nodeName: string,
  updatedNodeName: string,
): TopologyAnnotations {
  if (!annotations.nodeAnnotations) return annotations;

  return {
    ...annotations,
    nodeAnnotations: annotations.nodeAnnotations.map(annotation =>
      annotation.id === nodeName
        ? {...annotation, id: updatedNodeName}
        : annotation,
    ),
  };
}

export function removeNodeAnnotations(
  annotations: TopologyAnnotations,
  nodeNames: string[],
): TopologyAnnotations {
  if (!annotations.nodeAnnotations) return annotations;

  const removedNodes = new Set(nodeNames);

  return {
    ...annotations,
    nodeAnnotations: annotations.nodeAnnotations.filter(
      annotation => !removedNodes.has(annotation.id),
    ),
  };
}

/**
 * Removes the annotations of nodes that don't exist in the definition anymore.
 * Returns the given annotations if there are none.
 */
export function removeOrphanedNodeAnnotations(
  definition: YAMLDocument<TopologyDefinition>,
  annotations: TopologyAnnotations,
): TopologyAnnotations {
  const nodeMap = definition.getIn(['topology', 'nodes']);
  const nodeNames = new Set(
    isMap(nodeMap)
      ? nodeMap.items.map(item =>
          String(isScalar(item.key) ? item.key.value : item.key),
        )
      : [],
  );

  const orphanedNodes = (annotations.nodeAnnotations ?? [])
    .map(annotation => annotation.id)
    .filter(nodeName => !nodeNames.has(nodeName));

  if (orphanedNodes.length === 0) return annotations;

  return removeNodeAnnotations(annotations, orphanedNodes);
}

/**
 * Moves the layout stored in the graph-* labels of all nodes to the annotations.
 * Fields that are already set in an annotation are kept. Returns null if no node
 * has graph-* labels, otherwise the updated definition and annotations.
 *
 * @param definition The definition to remove the graph-* labels from.
 * @param annotations The annotations to move the layout to.
 */
export function convertGraphLabels(
  definition: YAMLDocument<TopologyDefinition>,
  annotations: TopologyAnnotations,
): {
  definition: YAMLDocument<TopologyDefinition>;
  annotations: TopologyAnnotations;
} | null {
  const nodeMap = definition.getIn(['topology', 'nodes']);
  if (!isMap(nodeMap)) return null;

  const annotationUpdates = new Map<string, Partial<NodeAnnotation>>();

  for (const item of nodeMap.items) {
    const nodeName = String(isScalar(item.key) ? item.key.value : item.key);
    const labels = isMap(item.value) ? item.value.get('labels') : undefined;

    if (!isMap(labels) || !GRAPH_LABELS.some(label => labels.has(label))) {
      continue;
    }

    const existing = findNodeAnnotation(annotations, nodeName);
    const update = Object.fromEntries(
      Object.entries(labelsToAnnotation(labels.toJSON() as NodeLabels)).filter(
        ([key, value]) => value !== undefined && existing?.[key] === undefined,
      ),
    );

    annotationUpdates.set(nodeName, update);
  }

  if (annotationUpdates.size === 0) return null;

  const updatedDefinition = definition.clone();

  for (const nodeName of annotationUpdates.keys()) {
    const yamlNode = updatedDefinition.getIn(['topology', 'nodes', nodeName]);
    if (!isMap(yamlNode)) continue;

    const labels = yamlNode.get('labels');
    if (!isMap(labels)) continue;

    for (const label of GRAPH_LABELS) {
      labels.delete(label);
    }

    if (labels.items.length === 0) {
      yamlNode.delete('labels');
    }
  }

  return {
    definition: updatedDefinition,
    annotations: updateNodeAnnotations(annotations, annotationUpdates),
  };
}

/**
 * Moves the membership of nodes in legacy groups, which reference their group by
 * name in the group field, to the groupId field. Groups without an annotation get
 * one with a box around their members. Returns null if no node uses the legacy
 * fields.
 */
export function convertLegacyGroups(
  annotations: TopologyAnnotations,
): TopologyAnnotations | null {
  const groups = annotations.groupStyleAnnotations ?? [];
  const legacyMembers = (annotations.nodeAnnotations ?? []).filter(
    annotation =>
      annotation.group !== undefined || annotation.level !== undefined,
  );
  if (legacyMembers.length === 0) return null;

  const memberUpdates = new Map<string, Partial<NodeAnnotation>>();
  const addedGroups = new Map<
    string,
    {name: string; level: string; positions: Position[]}
  >();

  for (const annotation of legacyMembers) {
    const groupId = nodeGroupId(annotation, groups);
    memberUpdates.set(annotation.id, {
      groupId: groupId ?? undefined,
      group: undefined,
      level: undefined,
    });

    if (groupId === null || groups.some(group => group.id === groupId)) {
      continue;
    }

    const addedGroup = addedGroups.get(groupId) ?? {
      name: annotation.group!,
      level: annotation.level ?? '1',
      positions: [],
    };

    const position = annotationPosition(annotation);
    if (position) addedGroup.positions.push(position);

    addedGroups.set(groupId, addedGroup);
  }

  let converted = updateNodeAnnotations(annotations, memberUpdates);

  for (const [groupId, group] of addedGroups) {
    const box = groupBoxAround(group.positions);
    if (!box) continue;

    converted = addAnnotationItem(converted, 'groupStyleAnnotations', {
      id: groupId,
      name: group.name,
      level: group.level,
      position: {x: box.x, y: box.y},
      width: box.width,
      height: box.height,
    });
  }

  return converted;
}

function annotationPosition(annotation: NodeAnnotation): Position | null {
  if (annotation.position) return annotation.position;
  if (!annotation.geoCoordinates) return null;

  return convertLatLngToXY(
    annotation.geoCoordinates.lat,
    annotation.geoCoordinates.lng,
  );
}

function mergeAnnotation<T extends {[key: string]: unknown}>(
  annotation: T,
  update: Partial<T>,
): T {
  const merged: T = {...annotation, ...update};

  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) delete merged[key];
  }

  return merged;
}
