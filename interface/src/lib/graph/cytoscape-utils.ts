import cytoscape, {ElementDefinition} from 'cytoscape';

import {
  Box,
  GraphGroup,
  readGraphGroups,
} from '@sb/lib/graph/annotation-geometry';
import {GRID_SPACING, placeNodes} from '@sb/lib/graph/placement';
import {readGraphNodes} from '@sb/lib/graph/topology-graph';
import {RunTopology, Topology} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

const DOT_RADIUS = 1.2;

export interface GraphIcons {
  getNodeIcon(icon?: string): string;
  getNodeShape(icon?: string): string;
}

export function generateGraph(
  topology: Topology | RunTopology,
  icons: GraphIcons,
): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const placedPositions = placeNodes(
    topology.definition,
    topology.annotations,
    topology.connections,
  );

  for (const node of readGraphNodes(
    topology.definition,
    topology.annotations,
  )) {
    elements.push({
      data: {
        id: node.name,
        label: node.name,
        title: node.name,
        kind: node.kind ?? '',
        image: icons.getNodeIcon(node.icon),
        shape: icons.getNodeShape(node.icon),
      },
      selectable: true,
      position: node.position ?? placedPositions.get(node.name),
      classes: 'topology-node',
    });
  }

  for (const connection of topology.connections) {
    elements.push({
      data: {
        id: connection.index.toString(),
        source: connection.hostNode,
        target: connection.targetNode,
        title: `${connection.hostNode}:${connection.hostInterface} <···> ${connection.targetNode}:${connection.targetInterface}`,
        sourceLabel: connection.hostInterface,
        targetLabel: connection.targetInterface,
      },
      classes: 'edge',
    });
  }

  return elements;
}

/**
 * Returns the groups of a topology, placed around the nodes of the generated
 * graph where they don't store a box of their own.
 */
export function generateGroups(
  topology: Topology | RunTopology,
  elements: ElementDefinition[],
): GraphGroup[] {
  const positions = new Map<string, Position>();
  for (const element of elements) {
    if (element.position) positions.set(element.data.id!, element.position);
  }

  const members = readGraphNodes(topology.definition, topology.annotations)
    .filter(node => positions.has(node.name))
    .map(node => ({...node, position: positions.get(node.name)!}));

  return readGraphGroups(
    topology.annotations.groupStyleAnnotations ?? [],
    members,
  );
}

export function getFitPadding(cy: cytoscape.Core) {
  return Math.min(cy.width(), cy.height()) * 0.1;
}

export function fitGraph(cy: cytoscape.Core, animated: boolean) {
  const eles = cy.elements();
  const padding = getFitPadding(cy);

  if (animated) {
    cy.animate({fit: {eles, padding}}, {duration: 200, easing: 'ease-in-out'});
  } else {
    cy.fit(eles, padding);
  }
}

/**
 * Positions the grid, a dot pattern in the container's background, so its dots
 * follow the graph's viewport. The dots are at the multiples of the grid
 * spacing, in the center of each tile of the pattern.
 */
export function updateGrid(container: HTMLElement, cy: cytoscape.Core) {
  const zoom = cy.zoom();
  const pan = cy.pan();
  const spacing = GRID_SPACING * zoom;

  container.style.backgroundSize = `${spacing}px ${spacing}px`;
  container.style.backgroundPosition = `${pan.x - spacing / 2}px ${pan.y - spacing / 2}px`;
  container.style.setProperty('--grid-dot-radius', `${DOT_RADIUS * zoom}px`);
}

/**
 * Moves and scales a layer so the content in it is positioned in graph
 * coordinates.
 */
export function updateLayerTransform(layer: HTMLElement, cy: cytoscape.Core) {
  const pan = cy.pan();
  layer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${cy.zoom()})`;
}

/**
 * Returns the position in the graph at the given position on screen.
 */
export function toGraphPosition(
  cy: cytoscape.Core,
  clientX: number,
  clientY: number,
): Position {
  const rect = cy.container()!.getBoundingClientRect();
  const pan = cy.pan();
  const zoom = cy.zoom();

  return {
    x: (clientX - rect.left - pan.x) / zoom,
    y: (clientY - rect.top - pan.y) / zoom,
  };
}

/**
 * Returns the given box of the graph in coordinates relative to the graph's
 * container.
 */
export function toRenderedBox(cy: cytoscape.Core, box: Box): Box {
  const pan = cy.pan();
  const zoom = cy.zoom();

  return {
    x: box.x * zoom + pan.x,
    y: box.y * zoom + pan.y,
    width: box.width * zoom,
    height: box.height * zoom,
  };
}
