import {Locator, Page} from '@playwright/test';

import {clickGraphNode} from '../helpers/cytoscape';
import {ConfirmDialog, menuItem} from './dialogs';

/** The view that opens over the dashboard when a lab is selected (`/#/?l=<labId>`). */
export class LabView {
  readonly root: Locator;
  readonly graph: Locator;
  readonly header: Locator;
  readonly properties: Locator;
  readonly drawer: NodeDrawer;

  constructor(private readonly page: Page) {
    // The view stays in the DOM when it's closed, so only count it while it's open
    this.root = page.locator('.sb-lab-view.open');
    this.graph = this.root.locator('.cytoscape-container');
    this.header = this.root.locator('.sb-lab-view-header');
    this.properties = page.locator('.sb-lab-view-properties');
    this.drawer = new NodeDrawer(page);
  }

  /** Opens a lab directly via its link. */
  async open(labId: string) {
    await this.page.goto(`/#/?l=${labId}`);
  }

  button(name: string): Locator {
    return this.header.getByRole('button', {name, exact: true});
  }

  get deployButton(): Locator {
    return this.button('Deploy lab');
  }

  get redeployButton(): Locator {
    return this.button('Redeploy Lab');
  }

  get destroyButton(): Locator {
    return this.button('Destroy Lab');
  }

  get logsButton(): Locator {
    return this.button('View logs');
  }

  /** The lab's name in the header ("<collection> / <lab>"). */
  get title(): Locator {
    return this.header.locator('.header-name');
  }

  /** The state in the header, e.g. "deploying" or "running". Only shown while the lab has an instance. */
  get state(): Locator {
    return this.header.locator('.header-meta > span').first();
  }

  async deploy() {
    await this.deployButton.click();
  }

  async destroy() {
    await this.destroyButton.click();
    await new ConfirmDialog(this.page).accept();
  }

  async close() {
    await this.button('Back').click();
  }

  /** Clicks a node in the live graph, which opens the drawer. */
  async clickNode(node: string) {
    await clickGraphNode(this.graph, node);
  }

  /** Right-clicks the empty graph background and picks an entry of its menu. */
  async backgroundMenu(item: string) {
    const box = await this.graph.boundingBox();
    if (!box) throw new Error('the graph is not visible');
    // The bottom centre: the properties panel covers the top left, the drawer the right
    await this.graph.click({
      button: 'right',
      position: {x: box.width / 2, y: box.height - 30},
    });
    await menuItem(this.page, item).click();
  }

  /** Right-clicks a node and picks an entry of its menu. */
  async nodeMenu(node: string, item: string) {
    await clickGraphNode(this.graph, node, {button: 'right'});
    await menuItem(this.page, item).click();
  }

  /** A property in the properties panel, e.g. "Owner" or "Collection". */
  property(name: string): Locator {
    return this.properties
      .locator('dt')
      .getByText(name, {exact: true})
      .locator('xpath=following-sibling::dd[1]');
  }
}

/** The drawer with a node's details, shown after clicking a node in the lab view. */
export class NodeDrawer {
  readonly root: Locator;
  readonly title: Locator;
  readonly state: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-lab-view-drawer');
    this.title = page.locator('.lab-dialog-drawer-header-title');
    this.state = page.locator('.lab-dialog-drawer-header-state');
  }

  button(name: string): Locator {
    return this.page
      .locator('.lab-dialog-drawer-content')
      .getByRole('button', {name, exact: true});
  }

  /** A property of the node, e.g. "Kind" or "Mgmt IPv4". */
  property(name: string): Locator {
    return this.page
      .locator('.lab-dialog-drawer-props dt')
      .getByText(name, {exact: true})
      .locator('xpath=following-sibling::dd[1]');
  }

  /** The title of a statistics plot, e.g. "CPU" or "Memory Usage". */
  plot(title: string): Locator {
    return this.page
      .locator('.lab-details-plot-title')
      .getByText(title, {exact: true});
  }
}

/** The log window of a lab. */
export class LogDialog {
  readonly root: Locator;
  readonly content: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-log-dialog').filter({visible: true});
    this.content = this.root.locator('.sb-log-dialog-content');
  }

  /** Shows the log of another source: "Antimony" (the lab) or a node name. */
  async selectSource(source: string) {
    await this.root.locator('.p-dropdown:has(#log-selector)').click();
    await this.page
      .locator('.p-dropdown-panel')
      .getByRole('option', {name: source, exact: true})
      .click();
  }

  async close() {
    await this.root.getByRole('button', {name: 'Close'}).click();
  }
}

/** The terminal window with one tab per open shell. */
export class TerminalDialog {
  readonly root: Locator;
  readonly tabs: Locator;
  readonly screen: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-terminal-dialog').filter({visible: true});
    this.tabs = this.root.locator('.sb-terminal-tab');
    // Only the selected tab's terminal is visible
    this.screen = this.root.locator('.xterm-rows').filter({visible: true});
  }

  tab(node: string): Locator {
    return this.tabs.filter({hasText: node});
  }

  /** Opens another terminal through the "+" picker. */
  async openNew(node: string) {
    await this.root.getByRole('button', {name: 'Open New Terminal'}).click();
    await this.page
      .locator('.sb-terminal-new-tab-overlay-entry')
      .filter({hasText: `${node} (`})
      .click();
  }

  async closeTab(node: string) {
    await this.tab(node).first().locator('.sb-terminal-tab-close').click();
  }

  /** Types into the visible terminal. */
  async type(text: string) {
    await this.screen.click();
    await this.page.keyboard.type(text);
  }
}
