import {DeviceStore} from '@sb/lib/stores/device-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {RunTopology, Topology} from '@sb/types/domain/topology';
import {FetchState, Position} from '@sb/types/types';
import {ElementDefinition} from 'cytoscape';
import {TooltipOptions} from 'primereact/tooltip/tooltipoptions';

export async function fetchResource<T>(
  url: string,
  method: string = 'GET',
  body?: T,
  requestHeaders?: HeadersInit
): Promise<Response | null> {
  try {
    return await fetch(url, {
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

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  pan: {x: number; y: number}
) {
  // const canvas = ctx.canvas;
  // const width = canvas.width;
  // const height = canvas.height;
  //
  // const gridSpacing = 40;
  // const gridColor = 'rgb(38,55,55)';
  // const largeGridColor = 'rgb(40,68,71)';
  //
  // ctx.clearRect(0, 0, width, height);
  // ctx.save();

  const width = window.outerWidth;
  const height = window.outerHeight;
  const gridSpacing = 50;
  const gridExtent = 4;
  const gridColor = 'rgb(38,55,55)';
  const largeGridColor = 'rgb(40,68,71)';

  ctx.strokeStyle = 'rgba(34, 51, 56, 1)';
  ctx.beginPath();

  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);

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

  // apply pan & zoom to align grid

  // const startX = -pan.x / zoom;
  // const startY = -pan.y / zoom;
  // const endX = startX + width / zoom;
  // const endY = startY + height / zoom;
  //
  // for (
  //   let x = Math.floor(startX / gridSpacing) * gridSpacing;
  //   x < endX;
  //   x += gridSpacing
  // ) {
  //   ctx.beginPath();
  //   ctx.lineWidth = x % (gridSpacing * 8) === 0 ? 2 : 1;
  //   ctx.strokeStyle = x % (gridSpacing * 8) === 0 ? largeGridColor : gridColor;
  //   ctx.moveTo(x, startY);
  //   ctx.lineTo(x, endY);
  //   ctx.stroke();
  // }
  //
  // for (
  //   let y = Math.floor(startY / gridSpacing) * gridSpacing;
  //   y < endY;
  //   y += gridSpacing
  // ) {
  //   ctx.beginPath();
  //   ctx.lineWidth = y % (gridSpacing * 8) === 0 ? 2 : 1;
  //   ctx.strokeStyle = y % (gridSpacing * 8) === 0 ? largeGridColor : gridColor;
  //   ctx.moveTo(startX, y);
  //   ctx.lineTo(endX, y);
  //   ctx.stroke();
  // }

  // ctx.restore();
}

export function pushOrCreateList<T, R>(map: Map<T, R[]>, key: T, value: R) {
  if (map.has(key)) {
    map.get(key)!.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function generateGraph(
  topology: Topology | RunTopology,
  deviceStore: DeviceStore,
  topologyManager: TopologyManager
): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const addedGroups = new Set<string>();

  const topologyNodes = Object.entries(
    topology.definition.toJS().topology.nodes
  );

  for (const [nodeName, node] of topologyNodes) {
    const posX = parseFloat(node?.labels?.['graph-posX'] ?? '');
    const posY = parseFloat(node?.labels?.['graph-posY'] ?? '');

    let position = {x: 0, y: 0};

    if (!isNaN(posX) && !isNaN(posY)) {
      position = {x: posX, y: posY};
    } else {
      const lat = parseFloat(node?.labels?.['graph-geoCoordinateLat'] ?? '');
      const lng = parseFloat(node?.labels?.['graph-geoCoordinateLng'] ?? '');

      if (!isNaN(lat) && !isNaN(lng)) {
        position = convertLatLngToXY(lat, lng);
      }
    }

    const group = node?.labels?.['graph-group'];
    const level = node?.labels?.['graph-level'];

    let parentId: string | undefined = undefined;

    if (group !== undefined) {
      const groupId = level !== undefined ? `${group}:${level}` : group;

      if (!addedGroups.has(groupId)) {
        elements.push(
          {
            group: 'nodes',
            data: {
              id: groupId,
              label: group,
            },
            classes: 'drawn-shape',
          },
          {
            group: 'nodes',
            data: {
              id: `close-${groupId}`,
            },
            position: {x: 0, y: 0},
            classes: 'compound-close-btn',
          }
        );
        addedGroups.add(groupId);
      }

      parentId = groupId;
    }

    elements.push({
      data: {
        id: nodeName,
        parent: parentId,
        label: nodeName,
        title: topologyManager.getNodeTooltip(nodeName),
        kind: node?.kind ?? '',
        image: deviceStore.getNodeIcon(node),
      },
      position: position,
      classes: 'topology-node',
    });
  }

  for (const connection of topology.connections) {
    elements.push({
      data: {
        id: connection.index.toString(),
        source: connection.hostNode,
        target: connection.targetNode,
        title: topologyManager.getEdgeTooltip(connection),
        sourceLabel: connection.hostInterface,
        targetLabel: connection.targetInterface,
      },
      classes: 'edge',
    });
  }

  return elements;
}

export function getDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export const SBTooltipOptions: TooltipOptions = {
  position: 'top',
  showDelay: 200,
  showOnDisabled: true,
};

const CANVAS_WIDTH = 5000;
const CANVAS_HEIGHT = 3000;
const LATITUDE_RANGE = 1.0;
const LONGITUDE_RANGE = 1.0;
const DEFAULT_AVERAGE_LAT = 48.6848;
const DEFAULT_AVERAGE_LNG = 9.0078;

export function convertXYToLatLng(
  x: number,
  y: number
): {lat: number; lng: number} {
  const lat = DEFAULT_AVERAGE_LAT - (y / CANVAS_HEIGHT) * LATITUDE_RANGE;
  const lng = DEFAULT_AVERAGE_LNG + (x / CANVAS_WIDTH) * LONGITUDE_RANGE;
  return {lat: Number(lat.toFixed(15)), lng: Number(lng.toFixed(15))};
}

export function convertLatLngToXY(
  lat: number,
  lng: number
): {x: number; y: number} {
  const y = (DEFAULT_AVERAGE_LAT - lat) * (CANVAS_HEIGHT / LATITUDE_RANGE);
  const x = (lng - DEFAULT_AVERAGE_LNG) * (CANVAS_WIDTH / LONGITUDE_RANGE);
  return {x: Number(x.toFixed(2)), y: Number(y.toFixed(2))};
}

export function conditional<T>(condition: boolean, onTrue: T, onFalse: T) {
  return condition ? onTrue : onFalse;
}

export function isValidURL(url: string) {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}
