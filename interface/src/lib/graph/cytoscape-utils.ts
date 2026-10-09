import cytoscape, {ElementDefinition} from 'cytoscape';

import {readGraphNodes} from '@sb/lib/graph/topology-graph';
import {RunTopology, Topology} from '@sb/types/domain/topology';

export const GRID_SPACING = 35;

const DOT_RADIUS = 1.2;
const DOT_COLOR = 'rgba(150, 150, 170, 0.4)';

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

export function drawGraphGrid(
  container: HTMLDivElement,
  canvas: HTMLCanvasElement,
  cy: cytoscape.Core,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCytoscapeGrid(cy, ctx);
}

export function drawCytoscapeGrid(
  cy: cytoscape.Core,
  ctx: CanvasRenderingContext2D,
): void {
  const pan = cy.pan();
  const zoom = cy.zoom();

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  ctx.clearRect(0, 0, W, H);

  const modelLeft = (0 - pan.x) / zoom;
  const modelTop = (0 - pan.y) / zoom;
  const modelRight = (W - pan.x) / zoom;
  const modelBottom = (H - pan.y) / zoom;

  const startX = Math.ceil(modelLeft / GRID_SPACING) * GRID_SPACING;
  const startY = Math.ceil(modelTop / GRID_SPACING) * GRID_SPACING;

  ctx.fillStyle = DOT_COLOR;

  const r = DOT_RADIUS * zoom;

  ctx.beginPath();

  for (let mx = startX; mx <= modelRight; mx += GRID_SPACING) {
    const sx = mx * zoom + pan.x;

    for (let my = startY; my <= modelBottom; my += GRID_SPACING) {
      const sy = my * zoom + pan.y;

      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
    }
  }

  ctx.fill();
}
