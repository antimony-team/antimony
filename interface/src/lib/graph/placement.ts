import cytoscape, {LayoutOptions} from 'cytoscape';
import fcose, {FcoseLayoutOptions} from 'cytoscape-fcose';

import {graphLinks, readGraphNodes} from '@sb/lib/graph/topology-graph';
import {TopologyAnnotations} from '@sb/types/domain/topology';
import {TopologyDefinition} from '@sb/types/domain/topology-definition';
import {Position} from '@sb/types/types';

export const GRID_SPACING = 35;

// Minimum distance between a placed node and all other nodes
const NODE_DISTANCE = GRID_SPACING * 2;

// Number of grid rings around the preferred position that are searched for a free spot
const MAX_SEARCH_RINGS = 100;

// Size of the nodes in the graph, which the layouts keep apart
const NODE_SIZE = 64;

// Topologies up to this size are laid out by connections, larger ones in circles as it would take too long
const FORCE_LAYOUT_MAX_NODES = 100;

const FORCE_LAYOUT: FcoseLayoutOptions = {
  name: 'fcose',
  randomize: true,
  quality: 'default',
  nodeRepulsion: 15000,
  nodeSeparation: 75,
  idealEdgeLength: 100,
  animate: false,
  fit: false,
};

const CIRCLE_LAYOUT: LayoutOptions = {
  name: 'concentric',
  concentric: node => node.degree(false),
  // Nodes with the same number of links share a circle
  levelWidth: () => 1,
  minNodeSpacing: NODE_DISTANCE - NODE_SIZE,
  animate: false,
  fit: false,
};

cytoscape.use(fcose);

// Placed positions by definition and annotations, the graph is generated again on every edit
// A link between two nodes of the graph
interface GraphLink {
  index: number;
  source: string;
  target: string;
}

const placementCache = new WeakMap<
  TopologyDefinition,
  WeakMap<TopologyAnnotations, Map<string, Position>>
>();

/*
 * Placed positions by the structure of the topology. Text edits replace the
 * definition every time, but most of them don't change anything the placement
 * depends on.
 *
 * This only matters for topologies with nodes that don't have a position yet,
 * which are topologies that have never been changed in the graph, e.g. pasted,
 * synced or only edited as text. Labs of these topologies never store positions,
 * and every update of a lab replaces its definition as well.
 */
const structureCache = new Map<string, Map<string, Position>>();

const MAX_STRUCTURE_CACHE_SIZE = 20;

/**
 * Positions of nodes, indexed by grid cell so the nodes around a position can be
 * found without checking all nodes.
 */
export class OccupiedPositions {
  private readonly cells = new Map<string, Position[]>();

  constructor(positions: Iterable<Position> = []) {
    for (const position of positions) {
      this.add(position);
    }
  }

  public add(position: Position) {
    const key = this.cellKey(
      Math.floor(position.x / NODE_DISTANCE),
      Math.floor(position.y / NODE_DISTANCE),
    );

    const cell = this.cells.get(key);
    if (cell) {
      cell.push(position);
    } else {
      this.cells.set(key, [position]);
    }
  }

  public isFree(position: Position): boolean {
    const cellX = Math.floor(position.x / NODE_DISTANCE);
    const cellY = Math.floor(position.y / NODE_DISTANCE);

    for (let x = cellX - 1; x <= cellX + 1; x++) {
      for (let y = cellY - 1; y <= cellY + 1; y++) {
        for (const other of this.cells.get(this.cellKey(x, y)) ?? []) {
          if (
            Math.hypot(other.x - position.x, other.y - position.y) <
            NODE_DISTANCE
          ) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Returns the free spot on the grid that is closest to the given position. The
   * grid is searched in rings around the position.
   */
  public findFreePosition(near: Position): Position {
    const centerX = Math.round(near.x / GRID_SPACING);
    const centerY = Math.round(near.y / GRID_SPACING);

    for (let ring = 0; ring <= MAX_SEARCH_RINGS; ring++) {
      for (let x = centerX - ring; x <= centerX + ring; x++) {
        for (let y = centerY - ring; y <= centerY + ring; y++) {
          // Only the outline of the ring, the inside has been searched already
          if (Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) !== ring) {
            continue;
          }

          const position = {x: x * GRID_SPACING, y: y * GRID_SPACING};
          if (this.isFree(position)) return position;
        }
      }
    }

    return {x: centerX * GRID_SPACING, y: centerY * GRID_SPACING};
  }

  private cellKey(x: number, y: number) {
    return `${x}:${y}`;
  }
}

/**
 * Returns positions for all nodes of a topology that don't have one.
 *
 * If no node has a position, all nodes are laid out by their connections, or in
 * circles for large topologies. Otherwise, the existing positions are kept. Nodes
 * that are linked to each other are laid out together next to the graph, single
 * nodes are placed close to the nodes they are linked to.
 *
 * The placement only depends on the topology, so the same topology is always
 * placed the same way.
 */
export function placeNodes(
  definition: TopologyDefinition,
  annotations: TopologyAnnotations,
): Map<string, Position> {
  let cachedPlacements = placementCache.get(definition);
  const cached = cachedPlacements?.get(annotations);
  if (cached) return cached;

  const nodes = readGraphNodes(definition, annotations);
  const connections: GraphLink[] = graphLinks(definition).map(link => ({
    index: link.index,
    source: link.endpoints[0].node,
    target: link.endpoints[1].node,
  }));
  const placedNodes = new Map<string, Position>();
  const unplacedNodes: string[] = [];

  for (const node of nodes) {
    if (node.position) {
      placedNodes.set(node.name, node.position);
    } else {
      unplacedNodes.push(node.name);
    }
  }

  let positions: Map<string, Position>;
  if (unplacedNodes.length === 0) {
    positions = new Map();
  } else {
    // The placement only depends on the nodes, their positions and their links
    const structure = JSON.stringify([
      nodes.map(node => [node.name, node.position]),
      connections.map(c => [c.source, c.target]),
    ]);

    positions =
      structureCache.get(structure) ??
      (placedNodes.size === 0
        ? layoutNodes(unplacedNodes, connections)
        : placeNearNeighbours(unplacedNodes, placedNodes, connections));

    // Kept as the most recent entry, the oldest one is removed once the cache is full
    structureCache.delete(structure);
    structureCache.set(structure, positions);
    if (structureCache.size > MAX_STRUCTURE_CACHE_SIZE) {
      structureCache.delete(structureCache.keys().next().value!);
    }
  }

  if (!cachedPlacements) {
    cachedPlacements = new WeakMap();
    placementCache.set(definition, cachedPlacements);
  }
  cachedPlacements.set(annotations, positions);

  return positions;
}

function layoutNodes(
  nodeNames: string[],
  connections: GraphLink[],
): Map<string, Position> {
  const nodeSet = new Set(nodeNames);
  const links = connections.filter(
    c => nodeSet.has(c.source) && nodeSet.has(c.target),
  );

  if (nodeNames.length <= FORCE_LAYOUT_MAX_NODES) {
    return resolveOverlaps(runLayout(nodeNames, links, FORCE_LAYOUT));
  }

  // Unlinked nodes would make the outermost circle very large, so they are put in a grid next to the circles
  const linkedNodes = new Set(links.flatMap(c => [c.source, c.target]));
  const positions = runLayout(
    nodeNames.filter(name => linkedNodes.has(name)),
    links,
    CIRCLE_LAYOUT,
  );

  const unlinkedNodes = nodeNames.filter(name => !linkedNodes.has(name));
  const bounds = getBounds([...positions.values()]);
  const origin = bounds
    ? {x: bounds.maxX + NODE_DISTANCE * 2, y: bounds.minY}
    : {x: 0, y: 0};

  for (const [nodeName, position] of gridPositions(unlinkedNodes, origin)) {
    positions.set(nodeName, position);
  }

  return positions;
}

function runLayout(
  nodeNames: string[],
  links: GraphLink[],
  options: LayoutOptions | FcoseLayoutOptions,
): Map<string, Position> {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    style: [{selector: 'node', style: {width: NODE_SIZE, height: NODE_SIZE}}],
    elements: [
      ...nodeNames.map(name => ({data: {id: name}})),
      ...links.map(c => ({
        data: {id: `${c.index}`, source: c.source, target: c.target},
      })),
    ],
  });

  // fcose uses random numbers, which are seeded so the same topology is always laid out the same way
  const random = Math.random;
  let seed = 1;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  try {
    cy.layout(options).run();
  } finally {
    Math.random = random;
  }

  const positions = new Map<string, Position>();
  for (const node of cy.nodes()) {
    positions.set(node.id(), {
      x: Math.round(node.position('x')),
      y: Math.round(node.position('y')),
    });
  }

  cy.destroy();

  return positions;
}

// Moves nodes that are too close to the nodes before them to the closest free spot
function resolveOverlaps(
  positions: Map<string, Position>,
): Map<string, Position> {
  const occupied = new OccupiedPositions();
  const resolved = new Map<string, Position>();

  for (const [nodeName, position] of positions) {
    const freePosition = occupied.isFree(position)
      ? position
      : occupied.findFreePosition(position);

    occupied.add(freePosition);
    resolved.set(nodeName, freePosition);
  }

  return resolved;
}

function gridPositions(
  nodeNames: string[],
  origin: Position,
): Map<string, Position> {
  const columns = Math.ceil(Math.sqrt(nodeNames.length));

  return new Map(
    nodeNames.map((name, index) => [
      name,
      {
        x: origin.x + (index % columns) * NODE_DISTANCE,
        y: origin.y + Math.floor(index / columns) * NODE_DISTANCE,
      },
    ]),
  );
}

function getBounds(positions: Position[]) {
  if (positions.length === 0) return null;

  return {
    minX: Math.min(...positions.map(p => p.x)),
    minY: Math.min(...positions.map(p => p.y)),
    maxX: Math.max(...positions.map(p => p.x)),
  };
}

function placeNearNeighbours(
  unplacedNodes: string[],
  placedNodes: Map<string, Position>,
  connections: GraphLink[],
): Map<string, Position> {
  const neighbours = new Map<string, string[]>();
  for (const connection of connections) {
    neighbours.set(connection.source, [
      ...(neighbours.get(connection.source) ?? []),
      connection.target,
    ]);
    neighbours.set(connection.target, [
      ...(neighbours.get(connection.target) ?? []),
      connection.source,
    ]);
  }

  const occupied = new OccupiedPositions(placedNodes.values());
  const positions = new Map<string, Position>();

  let maxX = Math.max(...[...placedNodes.values()].map(p => p.x));
  let minY = Math.min(...[...placedNodes.values()].map(p => p.y));

  const place = (nodeName: string, position: Position) => {
    occupied.add(position);
    placedNodes.set(nodeName, position);
    positions.set(nodeName, position);

    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
  };

  for (const group of linkedGroups(unplacedNodes, neighbours)) {
    // Linked nodes are laid out together next to the graph, so a pasted topology keeps its shape
    if (group.length > 1) {
      const layout = layoutNodes(group, connections);
      const bounds = getBounds([...layout.values()])!;
      const offsetX = maxX + NODE_DISTANCE * 2 - bounds.minX;
      const offsetY = minY - bounds.minY;

      for (const [nodeName, position] of layout) {
        place(nodeName, {x: position.x + offsetX, y: position.y + offsetY});
      }
      continue;
    }

    const placedNeighbours = (neighbours.get(group[0]) ?? [])
      .map(n => placedNodes.get(n))
      .filter(p => p !== undefined);

    // Nodes without placed neighbours are placed to the right of the graph
    const near =
      placedNeighbours.length > 0
        ? {
            x:
              placedNeighbours.reduce((sum, p) => sum + p.x, 0) /
              placedNeighbours.length,
            y:
              placedNeighbours.reduce((sum, p) => sum + p.y, 0) /
              placedNeighbours.length,
          }
        : {x: maxX + NODE_DISTANCE, y: minY};

    place(group[0], occupied.findFreePosition(near));
  }

  return positions;
}

// Splits the given nodes into groups of nodes that are linked to each other
function linkedGroups(
  nodeNames: string[],
  neighbours: Map<string, string[]>,
): string[][] {
  const nodeSet = new Set(nodeNames);
  const visited = new Set<string>();
  const groups: string[][] = [];

  for (const nodeName of nodeNames) {
    if (visited.has(nodeName)) continue;

    const group: string[] = [];
    const queue = [nodeName];
    visited.add(nodeName);

    while (queue.length > 0) {
      const current = queue.shift()!;
      group.push(current);

      for (const neighbour of neighbours.get(current) ?? []) {
        if (nodeSet.has(neighbour) && !visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }

    groups.push(group);
  }

  return groups;
}
