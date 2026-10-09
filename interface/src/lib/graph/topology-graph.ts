import {pushOrCreateList} from '@sb/lib/utils/utils';
import {InterfaceConfig} from '@sb/types/domain/device-info';
import {
  NodeConnection,
  NodeLabels,
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
  level?: number;
}

export type InterfaceConfigLookup = (nodeKind?: string) => InterfaceConfig;

const CANVAS_WIDTH = 5000;
const CANVAS_HEIGHT = 3000;
const LATITUDE_RANGE = 1.0;
const LONGITUDE_RANGE = 1.0;
const DEFAULT_AVERAGE_LAT = 48.6848;
const DEFAULT_AVERAGE_LNG = 9.0078;

export function convertXYToLatLng(
  x: number,
  y: number,
): {lat: number; lng: number} {
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

export function readGraphNodes(
  definition: YAMLDocument<TopologyDefinition>,
): GraphNode[] {
  const nodes = definition.toJS()?.topology?.nodes ?? {};

  return Object.entries(nodes).map(([name, node]) => ({
    name,
    kind: node?.kind,
    position: readNodePosition(node?.labels),
    icon: readNodeIcon(node),
    group: node?.labels?.['graph-group'],
    level: node?.labels?.['graph-level'],
  }));
}

export function readNodeIcon(node?: TopologyNode | null): string | undefined {
  return node?.labels?.['graph-icon'];
}

/**
 * Returns the graph-* labels that store a node's layout. Nodes that are placed
 * by geo coordinates keep them, all others store their position.
 */
export function nodeLayoutLabels(
  labels: NodeLabels | undefined,
  position: Position,
  group: string | null,
): Record<string, string | null> {
  const roundedPosition = {
    x: Number(position.x.toFixed(2)),
    y: Number(position.y.toFixed(2)),
  };

  const layoutLabels: Record<string, string | null> = {'graph-group': group};

  if (
    labels?.['graph-geoCoordinateLat'] ||
    labels?.['graph-geoCoordinateLng']
  ) {
    const geo = convertXYToLatLng(roundedPosition.x, roundedPosition.y);
    layoutLabels['graph-geoCoordinateLat'] = geo.lat.toString();
    layoutLabels['graph-geoCoordinateLng'] = geo.lng.toString();
  } else {
    layoutLabels['graph-posX'] = roundedPosition.x.toString();
    layoutLabels['graph-posY'] = roundedPosition.y.toString();
  }

  return layoutLabels;
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

function readNodePosition(labels?: NodeLabels): Position | null {
  const x = parseFloat(labels?.['graph-posX'] ?? '');
  const y = parseFloat(labels?.['graph-posY'] ?? '');

  if (!isNaN(x) && !isNaN(y)) return {x, y};

  const lat = parseFloat(labels?.['graph-geoCoordinateLat'] ?? '');
  const lng = parseFloat(labels?.['graph-geoCoordinateLng'] ?? '');

  if (!isNaN(lat) && !isNaN(lng)) return convertLatLngToXY(lat, lng);

  return null;
}
