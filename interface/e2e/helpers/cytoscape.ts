import {expect, Locator} from '@playwright/test';

/*
 * The topology graphs are drawn by Cytoscape on a <canvas>, so their nodes and links are not DOM elements.
 * These helpers ask the Cytoscape instance behind a `.cytoscape-container` element instead. Cytoscape
 * registers itself on its container element as `_cyreg.cy`.
 *
 * Topology nodes have the class `topology-node` and the node name as id. Links have the class `edge`.
 * Groups, shapes and texts are not part of Cytoscape: they are DOM elements, see pages/graph.ts.
 */

export type Position = {x: number; y: number};

type CytoscapeElement = HTMLElement & {
  _cyreg?: {cy?: CytoscapeCore};
};

type CytoscapeCollection = {
  map: <T>(fn: (element: CytoscapeEle) => T) => T[];
  filter: (fn: (element: CytoscapeEle) => boolean) => CytoscapeCollection;
  first: () => CytoscapeEle;
  length: number;
};

type CytoscapeEle = {
  id: () => string;
  hasClass: (className: string) => boolean;
  data: (key: string) => string;
  position: () => Position;
  renderedPosition: () => Position;
  renderedMidpoint: () => Position;
  selected: () => boolean;
};

type CytoscapeCore = {
  nodes: (selector?: string) => CytoscapeCollection;
  edges: (selector?: string) => CytoscapeCollection;
  $id: (id: string) => CytoscapeEle & {length: number};
  zoom: () => number;
  pan: () => Position;
};

/** Returns the names of all topology nodes in the graph. */
export async function graphNodes(container: Locator): Promise<string[]> {
  return container.evaluate((element: CytoscapeElement) => {
    const cy = element._cyreg?.cy;
    return cy?.nodes('.topology-node').map(node => node.id()) ?? [];
  });
}

/** Returns the names of the selected topology nodes. */
export async function selectedNodes(container: Locator): Promise<string[]> {
  return container.evaluate((element: CytoscapeElement) => {
    const cy = element._cyreg?.cy;
    return (
      cy
        ?.nodes('.topology-node')
        .filter(node => node.selected())
        .map(node => node.id()) ?? []
    );
  });
}

/** Returns the links in the graph as sorted [source, target] pairs. */
export async function graphEdges(
  container: Locator,
): Promise<[string, string][]> {
  return container.evaluate((element: CytoscapeElement) => {
    const cy = element._cyreg?.cy;
    return (
      cy
        ?.edges()
        .map(
          edge =>
            [edge.data('source'), edge.data('target')].sort() as [
              string,
              string,
            ],
        ) ?? []
    );
  });
}

/** Returns where Cytoscape draws a node, relative to the container. */
export async function nodePosition(
  container: Locator,
  nodeId: string,
): Promise<Position | undefined> {
  return container.evaluate((element: CytoscapeElement, id: string) => {
    const node = element._cyreg?.cy?.$id(id);
    return node && node.length > 0 ? node.renderedPosition() : undefined;
  }, nodeId);
}

/** Returns a node's position in graph coordinates, as stored in the annotations. */
export async function nodeModelPosition(
  container: Locator,
  nodeId: string,
): Promise<Position | undefined> {
  return container.evaluate((element: CytoscapeElement, id: string) => {
    const node = element._cyreg?.cy?.$id(id);
    return node && node.length > 0 ? node.position() : undefined;
  }, nodeId);
}

/** Converts a position in graph coordinates (as in the annotations) to one on the canvas. */
export async function toRendered(
  container: Locator,
  position: Position,
): Promise<Position> {
  return container.evaluate((element: CytoscapeElement, point: Position) => {
    const cy = element._cyreg!.cy!;
    const pan = cy.pan();
    const zoom = cy.zoom();
    return {x: point.x * zoom + pan.x, y: point.y * zoom + pan.y};
  }, position);
}

/** The current zoom level of the graph, 1 being 100%. */
export async function graphZoom(container: Locator): Promise<number> {
  return container.evaluate(
    (element: CytoscapeElement) => element._cyreg?.cy?.zoom() ?? 1,
  );
}

/** Waits until a node is in the graph and stopped moving, then returns its position. */
export async function settledNodePosition(
  container: Locator,
  nodeId: string,
): Promise<Position> {
  let position = await nodePosition(container, nodeId);

  await expect
    .poll(
      async () => {
        const previous = position;
        position = await nodePosition(container, nodeId);

        return (
          !!position && JSON.stringify(position) === JSON.stringify(previous)
        );
      },
      {
        message: `node "${nodeId}" must be in the graph and stop moving`,
        intervals: [100],
      },
    )
    .toBe(true);

  return position!;
}

/** Clicks a node at the position Cytoscape draws it, like a user would. */
export async function clickGraphNode(
  container: Locator,
  nodeId: string,
  options: {
    button?: 'left' | 'right';
    clickCount?: number;
    modifiers?: ('Shift' | 'Control' | 'Alt')[];
    // Offset from the node's centre, e.g. to hit its label below the icon
    offset?: Position;
  } = {},
) {
  const position = await settledNodePosition(container, nodeId);
  const {offset, ...clickOptions} = options;

  await container.click({
    position: {
      x: position.x + (offset?.x ?? 0),
      y: position.y + (offset?.y ?? 0),
    },
    ...clickOptions,
  });
}

/** Right-clicks the middle of the link between two nodes. */
export async function rightClickGraphEdge(
  container: Locator,
  between?: [string, string],
) {
  const position = await container.evaluate(
    (element: CytoscapeElement, ends: [string, string] | undefined) => {
      const edges = element._cyreg?.cy
        ?.edges()
        .filter(
          edge =>
            !ends ||
            [edge.data('source'), edge.data('target')].sort().join() ===
              [...ends].sort().join(),
        );
      return edges && edges.length > 0
        ? edges.first().renderedMidpoint()
        : undefined;
    },
    between,
  );

  if (!position) throw new Error('the graph has no such link');

  await container.click({position, button: 'right'});
}

/** Drags with the mouse across the graph, e.g. to draw a shape or move a node. */
export async function dragOnGraph(
  container: Locator,
  from: Position,
  to: Position,
  options: {modifiers?: ('Shift' | 'Control' | 'Alt')[]} = {},
) {
  const box = await container.boundingBox();
  if (!box) throw new Error('the graph is not visible');

  const page = container.page();
  for (const key of options.modifiers ?? []) await page.keyboard.down(key);
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, {steps: 12});
  await page.mouse.up();
  for (const key of options.modifiers ?? []) await page.keyboard.up(key);
}
