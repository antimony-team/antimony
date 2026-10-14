import {
  GeoCoordinates,
  NodeAnnotation,
  NodeLabels,
  TopologyAnnotations,
} from '@sb/types/domain/topology';
import {
  TopologyDefinition,
  TopologyLink,
} from '@sb/types/domain/topology-definition';
import {Position} from '@sb/types/types';

/**
 * A node of a topology together with its layout in the graph.
 */
export interface GraphNode {
  name: string;
  kind?: string;

  // Null if the topology doesn't define a position for the node
  position: Position | null;
  icon?: string;
  groupId?: string;

  // Legacy group membership by group name
  group?: string;
  level?: string;
}

/**
 * The layout of a node as it is set in the graph.
 */
export interface NodeLayout {
  position: Position;
  groupId: string | null;
}

/**
 * Legacy labels that store the layout of a node in topologies without annotations.
 * They are deprecated by all clab tools and are therefore only read and never
 * written back to the topology. As soon as the layout of a topology changes, all
 * labels are removed and replaced with annotations.
 */
export const GRAPH_LABELS = [
  'graph-icon',
  'graph-group',
  'graph-level',
  'graph-posX',
  'graph-posY',
  'graph-geoCoordinateLat',
  'graph-geoCoordinateLng',
];

const CANVAS_WIDTH = 5000;
const CANVAS_HEIGHT = 3000;
const LATITUDE_RANGE = 1.0;
const LONGITUDE_RANGE = 1.0;
const DEFAULT_AVERAGE_LAT = 48.6848;
const DEFAULT_AVERAGE_LNG = 9.0078;

export function convertXYToLatLng(x: number, y: number): GeoCoordinates {
  const lat = DEFAULT_AVERAGE_LAT - (y / CANVAS_HEIGHT) * LATITUDE_RANGE;
  const lng = DEFAULT_AVERAGE_LNG + (x / CANVAS_WIDTH) * LONGITUDE_RANGE;
  return {lat: Number(lat.toFixed(15)), lng: Number(lng.toFixed(15))};
}

export function convertLatLngToXY(
  lat: number,
  lng: number,
): {x: number; y: number} {
  const y = (DEFAULT_AVERAGE_LAT - lat) * (CANVAS_HEIGHT / LATITUDE_RANGE);
  const x = (lng - DEFAULT_AVERAGE_LNG) * (CANVAS_WIDTH / LONGITUDE_RANGE);
  return {x: Number(x.toFixed(2)), y: Number(y.toFixed(2))};
}

/**
 * Returns the nodes of a topology with their layout. The layout is read from the
 * annotations, and from the graph-* labels for nodes that don't have one there.
 */
export function readGraphNodes(
  definition: TopologyDefinition,
  annotations: TopologyAnnotations,
): GraphNode[] {
  const nodeAnnotations = nodeAnnotationMap(annotations);

  return [...definition.nodes.values()].map(node => {
    const annotation = nodeAnnotations.get(node.name);
    const labels = node.get('labels') as NodeLabels | undefined;

    return {
      name: node.name,

      // The kind can be inherited from a group or the defaults
      kind: node.device,
      position: readNodePosition(labels, annotation),
      icon: readNodeIcon(labels, annotation),
      groupId: annotation?.groupId,
      group: annotation?.group ?? labels?.['graph-group'],
      level: annotation?.level ?? labels?.['graph-level']?.toString(),
    };
  });
}

/**
 * Returns the links that the graph shows, the links between two nodes of the
 * topology. Links to the host or the management network have no second node.
 */
export function graphLinks(definition: TopologyDefinition): TopologyLink[] {
  const nodeNames = new Set(definition.nodeNames);

  return definition.links.filter(
    link =>
      link.endpoints.length === 2 &&
      link.endpoints.every(endpoint => nodeNames.has(endpoint.node)),
  );
}

export function readNodeIcon(
  labels: NodeLabels | undefined,
  annotation: NodeAnnotation | undefined,
): string | undefined {
  return annotation?.icon ?? labels?.['graph-icon'];
}

export function nodeAnnotationMap(
  annotations: TopologyAnnotations,
): Map<string, NodeAnnotation> {
  return new Map(
    (annotations.nodeAnnotations ?? []).map(annotation => [
      annotation.id,
      annotation,
    ]),
  );
}

/**
 * Returns the annotation fields that store the given layout of a node. Nodes that
 * are placed by geo coordinates keep them, all others store their position.
 */
export function nodeLayoutAnnotation(
  annotation: NodeAnnotation | undefined,
  layout: NodeLayout,
): Partial<NodeAnnotation> {
  const roundedPosition = {
    x: Number(layout.position.x.toFixed(2)),
    y: Number(layout.position.y.toFixed(2)),
  };

  const layoutAnnotation: Partial<NodeAnnotation> = {
    groupId: layout.groupId ?? undefined,
    group: undefined,
    level: undefined,
  };

  if (annotation?.geoCoordinates) {
    layoutAnnotation.geoCoordinates = convertXYToLatLng(
      roundedPosition.x,
      roundedPosition.y,
    );
    layoutAnnotation.position = undefined;
  } else {
    layoutAnnotation.position = roundedPosition;
    layoutAnnotation.geoCoordinates = undefined;
  }

  return layoutAnnotation;
}

/**
 * Returns the annotation fields that hold the layout stored in the graph-* labels
 * of a node.
 */
export function labelsToAnnotation(
  labels: NodeLabels,
): Partial<NodeAnnotation> {
  const annotation: Partial<NodeAnnotation> = {
    icon: labels['graph-icon'],
    group: labels['graph-group'],
    level: labels['graph-level']?.toString(),
  };

  const x = parseFloat(labels['graph-posX'] ?? '');
  const y = parseFloat(labels['graph-posY'] ?? '');
  if (!isNaN(x) && !isNaN(y)) annotation.position = {x, y};

  const lat = parseFloat(labels['graph-geoCoordinateLat'] ?? '');
  const lng = parseFloat(labels['graph-geoCoordinateLng'] ?? '');
  if (!isNaN(lat) && !isNaN(lng)) annotation.geoCoordinates = {lat, lng};

  return annotation;
}

function readNodePosition(
  labels: NodeLabels | undefined,
  annotation: NodeAnnotation | undefined,
): Position | null {
  if (annotation?.position) return annotation.position;

  if (annotation?.geoCoordinates) {
    return convertLatLngToXY(
      annotation.geoCoordinates.lat,
      annotation.geoCoordinates.lng,
    );
  }

  const x = parseFloat(labels?.['graph-posX'] ?? '');
  const y = parseFloat(labels?.['graph-posY'] ?? '');

  if (!isNaN(x) && !isNaN(y)) return {x, y};

  const lat = parseFloat(labels?.['graph-geoCoordinateLat'] ?? '');
  const lng = parseFloat(labels?.['graph-geoCoordinateLng'] ?? '');

  if (!isNaN(lat) && !isNaN(lng)) return convertLatLngToXY(lat, lng);

  return null;
}
