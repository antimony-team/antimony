import {expect, Locator, Page} from '@playwright/test';

import {
  clickGraphNode,
  dragOnGraph,
  graphNodes,
  Position,
  settledNodePosition,
  toRendered,
} from '../helpers/cytoscape';
import {menuItem} from './dialogs';

/**
 * The graph editor next to (or instead of) the code editor.
 *
 * Nodes and links are drawn by Cytoscape (see helpers/cytoscape.ts). Groups, shapes, lines and texts are
 * DOM elements on layers above and below the canvas, each with `data-layer-id` set to its annotation id.
 * The editor hit-tests them itself, so the tests click at their position like a user would.
 */
export class GraphEditor {
  readonly root: Locator;
  readonly canvas: Locator;
  readonly toolbar: Locator;
  readonly selectionBar: Locator;
  readonly labelEditor: Locator;
  readonly textEditor: Locator;
  readonly zoomLevel: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-node-editor');
    this.canvas = this.root.locator('.cytoscape-container');
    this.toolbar = page.locator('.sb-node-editor-toolbar');
    this.selectionBar = page
      .locator('.sb-selection-bar')
      .filter({visible: true});
    this.labelEditor = page.locator('.sb-label-editor input');
    this.textEditor = page.locator('textarea.sb-graph-text-editor');
    this.zoomLevel = page.locator('.sb-zoom-control-level');
  }

  /** A toolbar button: "Select", "Hand", "Add node", "Rectangle", "Ellipse", "Line", "Text", "Group", … */
  tool(name: string): Locator {
    return this.toolbar.getByRole('button', {name, exact: true});
  }

  /** A button of the selection bar, e.g. "Fill", "Delete" or "Arrow at the end". */
  barButton(name: string): Locator {
    return this.selectionBar.getByRole('button', {name, exact: true});
  }

  groups(): Locator {
    return this.page.locator('.sb-graph-group[data-layer-id]');
  }

  shapes(): Locator {
    return this.page.locator('.sb-graph-shape[data-layer-id]');
  }

  lines(): Locator {
    return this.page.locator('.sb-graph-line[data-layer-id]');
  }

  texts(): Locator {
    return this.page.locator('.sb-graph-text[data-layer-id]');
  }

  /** The DOM element of a group, shape, line or text, by its annotation id. */
  layer(id: string): Locator {
    return this.page.locator(`[data-layer-id="${id}"]`).first();
  }

  async waitForNodes(count: number) {
    await expect
      .poll(async () => (await graphNodes(this.canvas)).length)
      .toBe(count);
  }

  /** The size of the canvas, for picking positions relative to it. */
  async size(): Promise<{width: number; height: number}> {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error('the graph is not visible');
    return {width: box.width, height: box.height};
  }

  /** Where a node is drawn, relative to the canvas. */
  async nodeAt(node: string): Promise<Position> {
    // The graph moves while it fits itself into view, so wait until the node stays put
    return settledNodePosition(this.canvas, node);
  }

  /** The centre of a group, shape, line or text, relative to the canvas. */
  async layerCenter(id: string): Promise<Position> {
    const element = await this.layer(id).boundingBox();
    const canvas = await this.canvas.boundingBox();
    if (!element || !canvas) throw new Error(`${id} is not visible`);
    return {
      x: element.x - canvas.x + element.width / 2,
      y: element.y - canvas.y + element.height / 2,
    };
  }

  async clickAt(
    position: Position,
    options: Parameters<Locator['click']>[0] = {},
  ) {
    await this.canvas.click({position, ...options});
  }

  async clickNode(
    node: string,
    options: Parameters<typeof clickGraphNode>[2] = {},
  ) {
    await clickGraphNode(this.canvas, node, options);
  }

  /**
   * Clicks a group, shape or text where the editor finds it: groups at an empty spot inside their box,
   * near the bottom right corner (their label is an element of its own), everything else in its middle.
   */
  async clickLayer(
    id: string,
    options: {
      button?: 'left' | 'right';
      modifiers?: ('Shift' | 'Control')[];
      clickCount?: number;
    } = {},
  ) {
    const canvas = await this.canvas.boundingBox();
    const element = await this.layer(id).boundingBox();
    if (!element || !canvas) throw new Error(`${id} is not visible`);
    const isGroup = /group/.test(
      (await this.layer(id).getAttribute('class')) ?? '',
    );
    await this.canvas.click({
      position: isGroup
        ? {
            x: element.x - canvas.x + element.width - 10,
            y: element.y - canvas.y + element.height - 10,
          }
        : {
            x: element.x - canvas.x + element.width / 2,
            y: element.y - canvas.y + element.height / 2,
          },
      ...options,
    });
  }

  /** Clicks at a position given in graph coordinates, e.g. the middle of a stored line. */
  async clickAtGraph(
    position: Position,
    options: Parameters<Locator['click']>[0] = {},
  ) {
    await this.canvas.click({
      position: await toRendered(this.canvas, position),
      ...options,
    });
  }

  async drag(
    from: Position,
    to: Position,
    options: Parameters<typeof dragOnGraph>[3] = {},
  ) {
    await dragOnGraph(this.canvas, from, to, options);
  }

  /** Draws a rectangle, ellipse, line or group with its tool. */
  async draw(
    tool: 'Rectangle' | 'Ellipse' | 'Line' | 'Group',
    from: Position,
    to: Position,
  ) {
    await this.tool(tool).click();
    await this.drag(from, to);
  }

  /** Opens the context menu at a position or on a node and picks an entry. */
  async menuAt(position: Position, item: string) {
    await this.clickAt(position, {button: 'right'});
    await menuItem(this.page, item).click();
  }

  async nodeMenu(node: string, item: string) {
    await this.clickNode(node, {button: 'right'});
    await menuItem(this.page, item).click();
  }

  async layerMenu(id: string, item: string) {
    await this.clickLayer(id, {button: 'right'});
    await menuItem(this.page, item).click();
  }

  /** Presses a key while the graph has the focus (the last click must have been in the graph). */
  async press(key: string) {
    await this.page.keyboard.press(key);
  }
}
