import {isMap, isScalar} from 'yaml';

import {GRAPH_LABELS, labelsToAnnotation} from '@sb/lib/graph/topology-graph';
import {
  NodeAnnotation,
  NodeLabels,
  TopologyAnnotations,
  TopologyDefinition,
} from '@sb/types/domain/topology';
import {YAMLDocument} from '@sb/types/types';

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
      return mergeNodeAnnotation(annotation, update);
    },
  );

  for (const [nodeName, update] of pendingUpdates) {
    nodeAnnotations.push(mergeNodeAnnotation({id: nodeName}, update));
  }

  return {...annotations, nodeAnnotations};
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

function mergeNodeAnnotation(
  annotation: NodeAnnotation,
  update: Partial<NodeAnnotation>,
): NodeAnnotation {
  const merged: NodeAnnotation = {...annotation, ...update};

  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) delete merged[key];
  }

  return merged;
}
