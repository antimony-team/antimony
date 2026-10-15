import {Locator, Page} from '@playwright/test';

/** The topology editor page: the explorer tree on the left, the editor on the right. */
export class EditorPage {
  readonly explorer: Explorer;
  readonly editor: TopologyEditor;
  readonly nodeEditor: NodeEditor;

  constructor(private readonly page: Page) {
    this.explorer = new Explorer(page);
    this.editor = new TopologyEditor(page);
    this.nodeEditor = new NodeEditor(page);
  }

  /** Opens the editor, optionally with a topology or bind file selected via its deep link. */
  async goto(fileId?: string) {
    await this.page.goto(fileId ? `/#/editor?f=${fileId}` : '/#/editor');
  }
}

/** The tree of collections, topologies and bind files. */
export class Explorer {
  readonly root: Locator;
  readonly addCollectionButton: Locator;
  readonly search: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.p-tree');
    this.addCollectionButton = page.getByRole('button', {name: 'Add Group'});
    this.search = this.root.getByPlaceholder('Search');
  }

  /** The row of a collection, topology, file or directory, found by its exact label. */
  row(label: string): Locator {
    return this.root.locator('.p-treenode-content').filter({
      has: this.page.locator('.tree-node').getByText(label, {exact: true}),
    });
  }

  /** Expands the rows with the given labels, from the outside in, unless they already are. */
  async expand(...labels: string[]) {
    for (const label of labels) {
      const row = this.row(label);
      const node = row.locator('xpath=..');

      if ((await node.getAttribute('aria-expanded')) !== 'true') {
        await row.getByRole('button', {name: 'Expand Node'}).click();
      }
    }
  }

  /** Clicks one of the buttons that appear when hovering over a row, e.g. "Add Topology". */
  async rowAction(label: string, action: string) {
    const row = this.row(label);

    await row.hover();
    await row.getByRole('button', {name: action}).click();
  }

  /** Opens a topology or bind file in the editor. */
  async open(label: string) {
    await this.row(label).locator('.tree-node').click();
  }
}

/** The text editor with its toolbar. */
export class TopologyEditor {
  readonly toolbar: Locator;
  readonly monaco: Locator;
  readonly validationStatus: Locator;
  readonly saveButton: Locator;
  readonly unsavedBadge: Locator;

  constructor(page: Page) {
    this.toolbar = page.locator('.sb-topology-editor-toolbar');
    this.monaco = page.locator('.sb-monaco-wrapper .monaco-editor');
    this.validationStatus = page.getByTestId('validation-status');
    this.saveButton = this.button('Save');
    this.unsavedBadge = this.saveButton.locator('.p-badge');
  }

  button(name: string): Locator {
    return this.toolbar.getByRole('button', {name, exact: true});
  }

  async save() {
    await this.saveButton.click();
  }
}

/** The graph next to the text editor. */
export class NodeEditor {
  readonly root: Locator;
  readonly graph: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-node-editor');
    this.graph = this.root.locator('.cytoscape-container');
  }

  button(name: string): Locator {
    return this.root.getByRole('button', {name, exact: true});
  }

  /** An entry of the context menu that is currently open. */
  contextMenuItem(name: string): Locator {
    return this.page
      .locator('.p-contextmenu')
      .filter({visible: true})
      .getByRole('menuitem', {name});
  }
}
