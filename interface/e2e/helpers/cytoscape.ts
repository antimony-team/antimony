import {expect, Locator} from '@playwright/test';

/*
 * The topology graphs are drawn by Cytoscape on a <canvas>, so their nodes are not DOM elements.
 * These helpers ask the Cytoscape instance behind a `.cytoscape-container` element instead. Cytoscape
 * registers itself on its container element as `_cyreg.cy`.
 *
 * Topology nodes have the class `topology-node` and groups `drawn-shape`. While connecting nodes, the
 * editor adds temporary `ghost-node` and `ghost-edge` elements, which these helpers ignore.
 */

type Position = {x: number; y: number};

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
  parent: () => CytoscapeCollection;
  renderedPosition: () => Position;
  renderedMidpoint: () => Position;
};

type CytoscapeCore = {
  nodes: (selector?: string) => CytoscapeCollection;
  edges: (selector?: string) => CytoscapeCollection;
  $id: (id: string) => CytoscapeEle;
};

/** Returns the names of all topology nodes in the graph. */
export async function graphNodes(container: Locator): Promise<string[]> {
  return container.evaluate((element: CytoscapeElement) => {
    const cy = element._cyreg?.cy;
    return cy?.nodes('.topology-node').map(node => node.id()) ?? [];
  });
}

/** Returns the links in the graph as [source, target] pairs. */
export async function graphEdges(
  container: Locator,
): Promise<[string, string][]> {
  return container.evaluate((element: CytoscapeElement) => {
    const cy = element._cyreg?.cy;
    return (
      cy
        ?.edges()
        .filter(edge => !edge.hasClass('ghost-edge'))
        .map(edge => [edge.data('source'), edge.data('target')]) ?? []
    );
  });
}

/** Returns the group each topology node is in, or null if it isn't in a group. */
export async function graphGroups(
  container: Locator,
): Promise<Record<string, string | null>> {
  return container.evaluate((element: CytoscapeElement) => {
    const cy = element._cyreg?.cy;
    const groups: Record<string, string | null> = {};

    cy?.nodes('.topology-node').map(node => {
      const parent = node.parent();
      groups[node.id()] = parent.length > 0 ? parent.first().id() : null;
    });

    return groups;
  });
}

/** Returns where Cytoscape draws a node, relative to the container. */
export async function nodePosition(
  container: Locator,
  nodeId: string,
): Promise<Position | undefined> {
  return container.evaluate((element: CytoscapeElement, id: string) => {
    return element._cyreg?.cy?.$id(id).renderedPosition();
  }, nodeId);
}

/** Waits until a node is in the graph and the layout stopped moving it, then returns its position. */
async function settledNodePosition(
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
  options: {button?: 'left' | 'right'; clickCount?: number} = {},
) {
  const position = await settledNodePosition(container, nodeId);

  await container.click({position, ...options});
}

/** Right-clicks the middle of the first link in the graph. */
export async function rightClickGraphEdge(container: Locator) {
  const position = await container.evaluate((element: CytoscapeElement) => {
    return element._cyreg?.cy
      ?.edges()
      .filter(edge => !edge.hasClass('ghost-edge'))
      .first()
      .renderedMidpoint();
  });

  if (!position) throw new Error('the graph has no links');

  await container.click({position, button: 'right'});
}

/** Drags the mouse across the graph background, e.g. to draw a group around nodes. */
export async function dragOnGraph(
  container: Locator,
  from: Position,
  to: Position,
) {
  const box = await container.boundingBox();
  if (!box) throw new Error('the graph is not visible');

  const page = container.page();
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, {steps: 10});
  await page.mouse.up();
}
