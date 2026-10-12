import cytoscape, {ElementDefinition} from 'cytoscape';

import {
  Box,
  GraphGroup,
  LayerItem,
  readGraphGroups,
  readGraphShapes,
  readLayerItems,
  unionBox,
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
      // Links are only highlighted while their context menu is open
      selectable: false,
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
    topology.annotations.freeShapeAnnotations ?? [],
    topology.annotations.freeTextAnnotations ?? [],
  );
}

export function generateLayerItems(
  topology: Topology | RunTopology,
  groups: GraphGroup[],
): LayerItem[] {
  return readLayerItems(
    groups,
    readGraphShapes(topology.annotations.freeShapeAnnotations ?? []),
  );
}

export function getFitPadding(cy: cytoscape.Core) {
  return Math.min(cy.width(), cy.height()) * 0.1;
}

/**
 * Zooms and pans the graph so its elements and the given boxes are visible.
 *
 * @param cy The graph to fit.
 * @param animated Whether the viewport moves to the fitted one.
 * @param boxes Additional boxes in graph coordinates, e.g. of annotations.
 */
export function fitGraph(
  cy: cytoscape.Core,
  animated: boolean,
  boxes: Box[] = [],
) {
  const elements = cy.elements();
  const bounds = unionBox([
    ...(elements.nonempty() ? [boundsToBox(elements.boundingBox())] : []),
    ...boxes,
  ]);
  if (!bounds) return;

  const padding = getFitPadding(cy);
  const zoom = Math.min(
    cy.maxZoom(),
    Math.max(
      cy.minZoom(),
      Math.min(
        (cy.width() - padding * 2) / Math.max(bounds.width, 1),
        (cy.height() - padding * 2) / Math.max(bounds.height, 1),
      ),
    ),
  );
  const pan = {
    x: cy.width() / 2 - zoom * (bounds.x + bounds.width / 2),
    y: cy.height() / 2 - zoom * (bounds.y + bounds.height / 2),
  };

  if (animated) {
    cy.animate({zoom, pan}, {duration: 200, easing: 'ease-in-out'});
  } else {
    cy.viewport({zoom, pan});
  }
}

export function boundsToBox(
  bounds: cytoscape.BoundingBox12 & {w: number; h: number},
): Box {
  return {x: bounds.x1, y: bounds.y1, width: bounds.w, height: bounds.h};
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
  const zoom = String(cy.zoom());
  layer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  // The zoom is only set when it changes, as setting it restyles the whole layer
  if (layer.style.getPropertyValue('--sb-graph-zoom') !== zoom) {
    layer.style.setProperty('--sb-graph-zoom', zoom);
  }
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
