import {expect, Locator, Page} from '@playwright/test';

import {editorText, setEditorText} from '../helpers/monaco';
import {ConfirmDialog, Dialog, menuItem} from './dialogs';
import {GraphEditor} from './graph';

/** The topology editor page: the explorer on the left, the editor of the open file on the right. */
export class EditorPage {
  readonly explorer: Explorer;
  readonly editor: TopologyEditor;
  readonly graph: GraphEditor;

  constructor(readonly page: Page) {
    this.explorer = new Explorer(page);
    this.editor = new TopologyEditor(page);
    this.graph = new GraphEditor(page);
  }

  async goto(fileId?: string) {
    await this.page.goto(fileId ? `/#/editor?f=${fileId}` : '/#/editor');
  }

  /** Opens a topology or bind file by its ID and waits until it's shown. */
  async open(fileId: string, title: string) {
    await this.goto(fileId);
    await this.editor.waitForTitle(title);
  }
}

/** The tree of collections, topologies and bind files. */
export class Explorer {
  readonly root: Locator;
  readonly filter: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-topology-explorer');
    this.filter = this.root.getByPlaceholder('Search Topologies');
  }

  /** The row of a tree node, found by its label (collection, topology, file or directory name). */
  row(label: string): Locator {
    return this.root.locator('.p-treenode-content').filter({
      has: this.page.locator('.tree-node').getByText(label, {exact: true}),
    });
  }

  /** Expands a collapsed node, e.g. a collection to see its topologies. */
  async expand(label: string) {
    const node = this.row(label).locator('xpath=ancestor::li[1]');
    if ((await node.getAttribute('aria-expanded')) !== 'true') {
      await this.row(label).getByRole('button', {name: 'Expand Node'}).click();
    }
  }

  /** Clicks a topology or file to open it. */
  async open(label: string) {
    await this.row(label).locator('.tree-node').click();
  }

  /** A hover button of a row: "Add Topology", "Deploy Topology" or the "…" menu ("More options"). */
  rowButton(label: string, button: string): Locator {
    return this.row(label).getByRole('button', {name: button, exact: true});
  }

  /** Opens the context menu of a row with a right click and picks an entry. */
  async menu(label: string, item: string) {
    await this.row(label).click({button: 'right'});
    await menuItem(this.page, item).click();
  }

  /** Opens the context menu of the empty explorer background and picks an entry. */
  async backgroundMenu(item: string) {
    const box = await this.root.boundingBox();
    if (!box) throw new Error('the explorer is not visible');
    await this.root.click({
      button: 'right',
      position: {x: box.width / 2, y: box.height - 20},
    });
    await menuItem(this.page, item).click();
  }

  /** The dialog for creating and editing collections. */
  collectionDialog(title: 'New collection' | 'Edit collection'): Dialog {
    return new Dialog(this.page, title);
  }

  /** The dialog for creating, editing and duplicating topologies. */
  topologyDialog(
    title: 'Add topology' | 'Edit topology' | 'Duplicate topology',
  ): Dialog {
    return new Dialog(this.page, title);
  }

  /** The dialog fills in the collection a moment after it opens; waits for it. */
  async waitForDialogCollection(dialog: Dialog, collection: string) {
    await expect(dialog.root.locator('#edit-topology-collection')).toHaveValue(
      collection,
    );
  }

  fileDialog(title: 'Add file' | 'Edit file' | 'Edit directory'): Dialog {
    return new Dialog(this.page, title);
  }

  /** Sets a switch in the collection dialog ("Anyone can deploy" / "Anyone can edit"). */
  async setCollectionFlag(
    dialog: Dialog,
    flag: 'publicdeploy' | 'publicwrite',
    on: boolean,
  ) {
    const toggle = dialog.root.locator(`#collection-edit-${flag}`);
    const checked = /p-inputswitch-checked/.test(
      (await toggle.getAttribute('class')) ?? '',
    );
    if (checked !== on) await toggle.click();
  }
}

/** The editor of the open file: toolbar, Monaco, graph and footer. */
export class TopologyEditor {
  readonly toolbar: Locator;
  readonly title: Locator;
  readonly crumbs: Locator;
  readonly monaco: Locator;
  readonly validation: Locator;
  readonly footer: Locator;
  readonly stats: Locator;
  readonly save: Locator;
  readonly undo: Locator;
  readonly redo: Locator;
  readonly download: Locator;
  readonly deploy: Locator;
  readonly syncOptions: Locator;
  readonly fileSwitch: Locator;
  readonly readOnlyBanner: Locator;

  constructor(private readonly page: Page) {
    this.toolbar = page.locator('.sb-topology-editor-toolbar');
    this.title = page.locator('.sb-topology-editor-toolbar-title');
    this.crumbs = page.locator('.sb-topology-editor-toolbar-crumbs');
    this.monaco = page.locator('.sb-monaco-wrapper');
    this.validation = page.locator('.sb-monaco-wrapper-error');
    this.footer = page.locator('.sb-topology-editor-footer');
    this.stats = this.footer.locator('.sb-dot-separated');
    this.save = this.toolbar.getByRole('button', {name: 'Save', exact: true});
    this.undo = this.toolbar.getByRole('button', {name: 'Undo', exact: true});
    this.redo = this.toolbar.getByRole('button', {name: 'Redo', exact: true});
    this.download = this.toolbar.getByRole('button', {name: 'Download'});
    this.deploy = this.toolbar.getByRole('button', {name: 'Deploy Topology'});
    this.syncOptions = this.toolbar.getByRole('button', {name: 'Sync Options'});
    this.fileSwitch = this.toolbar.getByRole('button', {name: 'Open file'});
    this.readOnlyBanner = page.locator('.sb-monaco-wrapper-readonly');
  }

  /** Waits until the title shows a file name, with or without the "unsaved" star. */
  async waitForTitle(name: string) {
    await this.title
      .filter({hasText: new RegExp(`${escape(name)}\\*?$`)})
      .waitFor();
  }

  /** The red dot on the Save button while there are unsaved changes. */
  get unsavedDot(): Locator {
    return this.save.locator('.p-badge');
  }

  /** "Valid", "Pending" or "Error" (data-validation-state "done", "working" or "error"). */
  get validationState(): Promise<string | null> {
    return this.validation.getAttribute('data-validation-state');
  }

  async setText(text: string) {
    await setEditorText(this.monaco, text);
  }

  async text(): Promise<string> {
    return editorText(this.monaco);
  }

  /** Switches between the topology file and its annotations. */
  async switchFile(file: 'Topology' | 'Annotations') {
    await this.fileSwitch.click();
    await this.page
      .getByRole('listbox', {name: 'Topology files'})
      .locator('.sb-topology-file-switch-option')
      .filter({
        has: this.page
          .locator('.sb-topology-file-switch-option-label')
          .getByText(file, {exact: true}),
      })
      .click();
  }

  /** Switches the editor view: "Code", "Split" or "Graph". */
  view(view: 'Code' | 'Split' | 'Graph'): Locator {
    return this.page
      .getByRole('radiogroup', {name: 'Editor view'})
      .getByRole('radio', {name: new RegExp(`${view}$`)});
  }

  async saveWithKeyboard() {
    // The editor checks for a lowercase "s" with Ctrl
    await this.page.keyboard.press('Control+s');
  }

  /** Accepts or rejects the confirmation shown when leaving a file with unsaved changes. */
  async discardChanges(discard: boolean) {
    const confirm = new ConfirmDialog(this.page);
    if (discard) await confirm.accept('Discard changes');
    else await confirm.reject('Keep editing');
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
