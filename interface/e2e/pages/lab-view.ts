import {Locator, Page} from '@playwright/test';

import {DashboardPage} from './dashboard-page';
import {ConfirmDialog} from './dialogs';

/** The view that opens over the dashboard when a lab is selected. */
export class LabView {
  readonly root: Locator;
  readonly graph: Locator;
  readonly drawer: NodeDrawer;

  constructor(private readonly page: Page) {
    // The view stays in the DOM when it's closed, so only count it while it's open
    this.root = page.locator('.sb-lab-view.open');
    this.graph = this.root.locator('.cytoscape-container');
    this.drawer = new NodeDrawer(page);
  }

  /** Opens a lab from the dashboard, the way a user does. */
  async open(labId: string, labName: string) {
    await new DashboardPage(this.page).openLab(labId, labName);
  }

  /** Opens a lab directly via its deep link. */
  async openByLink(labId: string) {
    await this.page.goto(`/#/?l=${labId}`);
  }

  button(name: string): Locator {
    return this.root
      .locator('.sb-lab-view-header')
      .getByRole('button', {name, exact: true});
  }

  /**
   * The state in the header, e.g. "deploying" or "running". Only shown while the lab has an instance.
   */
  get state(): Locator {
    return this.root.locator('.header-meta > span').first();
  }

  async deploy() {
    await this.button('Deploy Lab').click();
  }

  async destroy() {
    await this.button('Destroy Lab').click();
    await new ConfirmDialog(this.page).accept();
  }

  async close() {
    await this.button('Back').click();
  }

  /** An entry of the node context menu that is currently open. */
  contextMenuItem(name: string): Locator {
    return this.page
      .locator('.p-contextmenu')
      .filter({visible: true})
      .getByRole('menuitem', {name});
  }
}

/** The drawer with a node's details, shown after clicking a node in the lab view. */
export class NodeDrawer {
  readonly title: Locator;
  readonly state: Locator;

  constructor(private readonly page: Page) {
    this.title = page.locator('.lab-dialog-drawer-header-title');
    this.state = page.locator('.lab-dialog-drawer-header-state');
  }

  button(name: string): Locator {
    return this.page
      .locator('.lab-dialog-drawer-content')
      .getByRole('button', {name, exact: true});
  }

  /** The title of a statistics plot, e.g. "CPU" or "Memory Usage". */
  plot(title: string): Locator {
    return this.page
      .locator('.lab-details-plot-title')
      .getByText(title, {exact: true});
  }
}
