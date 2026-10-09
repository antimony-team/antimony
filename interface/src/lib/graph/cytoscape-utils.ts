import cytoscape, {ElementDefinition} from 'cytoscape';

import {readGraphNodes} from '@sb/lib/graph/topology-graph';
import {RunTopology, Topology} from '@sb/types/domain/topology';

export const GRID_SPACING = 35;

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
  const addedGroups = new Set<string>();

  for (const node of readGraphNodes(topology.definition)) {
    let parentId: string | undefined = undefined;

    if (node.group !== undefined) {
      const groupId =
        node.level !== undefined ? `${node.group}:${node.level}` : node.group;

      if (!addedGroups.has(groupId)) {
        elements.push({
          group: 'nodes',
          data: {
            id: groupId,
            label: node.group,
          },
          classes: 'drawn-shape',
        });
        addedGroups.add(groupId);
      }

      parentId = groupId;
    }

    elements.push({
      data: {
        id: node.name,
        parent: parentId,
        label: node.name,
        title: node.name,
        kind: node.kind ?? '',
        image: icons.getNodeIcon(node.icon),
        shape: icons.getNodeShape(node.icon),
      },
      selectable: true,
      position: node.position ?? {x: 0, y: 0},
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
