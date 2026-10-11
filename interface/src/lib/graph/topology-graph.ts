import {pushOrCreateList} from '@sb/lib/utils/utils';
import {InterfaceConfig} from '@sb/types/domain/device-info';
import {
  GeoCoordinates,
  NodeAnnotation,
  NodeConnection,
  NodeLabels,
  TopologyAnnotations,
  TopologyDefinition,
  TopologyMeta,
  TopologyNode,
} from '@sb/types/domain/topology';
import {Position, YAMLDocument} from '@sb/types/types';

/**
 * A node of a topology together with its layout in the graph.
 */
export interface GraphNode {
  name: string;
  kind?: string;

  // Null if the topology doesn't define a position for the node
  position: Position | null;
  icon?: string;
  group?: string;
  level?: string;
}

/**
 * The layout of a node as it is set in the graph.
 */
export interface NodeLayout {
  position: Position;
  group: string | null;
}

export type InterfaceConfigLookup = (nodeKind?: string) => InterfaceConfig;

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
  definition: YAMLDocument<TopologyDefinition>,
  annotations: TopologyAnnotations,
): GraphNode[] {
  const nodes = definition.toJS()?.topology?.nodes ?? {};
  const nodeAnnotations = nodeAnnotationMap(annotations);

  return Object.entries(nodes).map(([name, node]) => {
    const annotation = nodeAnnotations.get(name);

    return {
      name,
      kind: node?.kind,
      position: readNodePosition(node?.labels, annotation),
      icon: readNodeIcon(node, annotation),
      group: annotation?.group ?? node?.labels?.['graph-group'],
      level: annotation?.level ?? node?.labels?.['graph-level']?.toString(),
    };
  });
}

export function readNodeIcon(
  node: TopologyNode | null | undefined,
  annotation: NodeAnnotation | undefined,
): string | undefined {
  return annotation?.icon ?? node?.labels?.['graph-icon'];
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
    group: layout.group ?? undefined,
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

export function buildTopologyMetadata(
  topology: YAMLDocument<TopologyDefinition>,
  getInterfaceConfig: InterfaceConfigLookup,
): TopologyMeta {
  const nodes = topology.toJS()?.topology?.nodes ?? {};
  const links = topology.toJS()?.topology?.links;
  const nodeCount = Object.keys(nodes).length;

  const connections: NodeConnection[] = [];
  const connectionMap = new Map<string, NodeConnection[]>();

  if (!Array.isArray(links)) {
    return {nodeCount, connections, connectionMap};
  }

  let index = 0;

  for (const link of links) {
    const [hostNode, hostInterface] = link.endpoints[0].split(':');
    const [targetNode, targetInterface] = link.endpoints[1].split(':');

    // Ignore the link if one of the nodes does not exist
    if (!nodes[hostNode] || !nodes[targetNode]) continue;

    const hostInterfaceConfig = getInterfaceConfig(nodes[hostNode].kind);
    const targetInterfaceConfig = getInterfaceConfig(nodes[targetNode].kind);

    const hostInterfaceIndex = parseInterface(
      hostInterface,
      hostInterfaceConfig.interfacePattern,
    );
    const targetInterfaceIndex = parseInterface(
      targetInterface,
      targetInterfaceConfig.interfacePattern,
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

    pushOrCreateList(connectionMap, targetNode, {
      index,
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

  return {nodeCount, connections, connectionMap};
}

export function parseInterface(
  value: string,
  interfacePattern: string,
): number {
  const pattern = new RegExp(interfacePattern.replaceAll('$', '(\\d+)'));
  const match = value.match(pattern);

  if (!match || match.length < 2) return 99;
  return Number(match[1]);
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
