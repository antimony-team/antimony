import {TooltipOptions} from 'primereact/tooltip/tooltipoptions';
import {Edge, Node} from 'vis';
import {DataSet} from 'vis-data/peer';

import {DeviceStore} from '@sb/lib/stores/device-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {FetchState} from '@sb/types/types';
import {Topology} from '@sb/types/domain/topology';
import {NodeMeta} from '@sb/types/domain/lab';

export async function fetchResource<T>(
  path: string,
  method: string,
  body?: T,
  requestHeaders?: HeadersInit
): Promise<Response | null> {
  try {
    return await fetch(path, {
      method: method,
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export function matchesSearch(value: string, search: string) {
  return value.toLowerCase().includes(search.toLowerCase());
}

export function combinedFetchState(...fetchStates: FetchState[]): FetchState {
  const states = new Set(fetchStates);
  if (states.has(FetchState.Error)) return FetchState.Error;
  if (states.has(FetchState.Pending)) return FetchState.Pending;

  return FetchState.Done;
}

export function filterSchemaEnum(values: string[] | undefined) {
  if (values === undefined) return undefined;

  const unqiueIndices = [];
  const filteredValues = new Set<string>();

  for (let i = 0; i < values.length; i++) {
    if (filteredValues.has(values[i].toLowerCase())) continue;

    filteredValues.add(values[i].toLowerCase());
    unqiueIndices.push(i);
  }

  return unqiueIndices.map(index => values[index]);
}

export function arrayOf(value: string, length: number) {
  return [...Array(length)].map(() => value);
}

export function drawGrid(ctx: CanvasRenderingContext2D) {
  const width = window.outerWidth;
  const height = window.outerHeight;
  const gridSpacing = 50;
  const gridExtent = 4;
  const gridColor = 'rgb(38,55,55)';
  const largeGridColor = 'rgb(40,68,71)';

  ctx.strokeStyle = 'rgba(34, 51, 56, 1)';
  ctx.beginPath();

  for (let x = -width * gridExtent; x <= width * gridExtent; x += gridSpacing) {
    ctx.beginPath();
    if (x % 8 === 0) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = largeGridColor;
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = gridColor;
    }
    ctx.moveTo(x, height * gridExtent);
    ctx.lineTo(x, -height * gridExtent);
    ctx.stroke();
  }
  for (
    let y = -height * gridExtent;
    y <= height * gridExtent;
    y += gridSpacing
  ) {
    ctx.beginPath();
    if (y % 8 === 0) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = largeGridColor;
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = gridColor;
    }
    ctx.moveTo(width * gridExtent, y);
    ctx.lineTo(-width * gridExtent, y);
    ctx.stroke();
  }
}

export function pushOrCreateList<T, R>(map: Map<T, R[]>, key: T, value: R) {
  if (map.has(key)) {
    map.get(key)!.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function generateGraph(
  topology: Topology,
  deviceStore: DeviceStore,
  topologyManager: TopologyManager,
  showHostLabels?: boolean,
  topologyNodeMeta?: NodeMeta[]
) {
  const nodes: DataSet<Node> = new DataSet();

  for (const [index, [nodeName, node]] of Object.entries(
    topology.definition.toJS().topology.nodes
  ).entries()) {
    let nodeLabel = nodeName;
    if (showHostLabels && topologyNodeMeta && topologyNodeMeta.length > index) {
      const meta = topologyNodeMeta[index];
      nodeLabel = `${nodeName}\n${meta.webSsh}:${meta.port}`;
    }
    nodes.add({
      id: nodeName,
      label: nodeLabel,
      image: deviceStore.getNodeIcon(node?.kind),
      x: topology.positions.get(nodeName)?.x,
      y: topology.positions.get(nodeName)?.y,
      fixed: {
        x: true,
        y: true,
      },
      title: topologyManager.getNodeTooltip(nodeName),
    });
  }

  /*
   * We can safely assume that the endpoint strings are in the correct
   * format here since this is enforced by the schema and the node editor
   * only receives valid definitions get pushed to the node editor.
   */
  const edges: DataSet<Edge> = new DataSet(
    topology.connections.map(connection => ({
      id: connection.index,
      from: connection.hostNode,
      to: connection.targetNode,
      title: topologyManager.getEdgeTooltip(connection),
    }))
  );

  return {nodes: nodes, edges: edges};
}

export function generateUuidv4() {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16)
  );
}

export const SBTooltipOptions: TooltipOptions = {
  position: 'top',
  showDelay: 200,
  showOnDisabled: true,
};
