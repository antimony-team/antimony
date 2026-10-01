import {topologyDefinition} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {editorText, setEditorText} from '../helpers/monaco';
import {ConfirmDialog, Dialog, toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

test.describe('topologies', () => {
  test('a topology can be created in a collection', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.rowAction(collection.name, 'Add Topology');
    const dialog = new Dialog(page, 'Add Topology');
    await dialog.fill('Topology Name', name);
    await dialog.button('Apply').click();

    await expect(
      toast(page, 'Topology has been created successfully.'),
    ).toBeVisible();
    await expect(editor.explorer.row(name)).toBeVisible();

    // The new topology is opened right away
    await expect(page).toHaveURL(/editor\?f=/);
    await expect.poll(() => editorText(editor.editor.monaco)).toContain(name);

    const topologies = await api.getTopologies();
    const created = topologies.find(t => t.definition.includes(name));
    expect(created?.collectionId).toBe(collection.id);
  });

  test('a topology needs a name', async ({page, createCollection}) => {
    const collection = await createCollection();
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.rowAction(collection.name, 'Add Topology');
    const dialog = new Dialog(page, 'Add Topology');
    await dialog.button('Apply').click();

    await expect(dialog.validationError()).toHaveText("Name can't be empty");
  });

  test('topology names are unique within a collection', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    await api.createTopology(collection.id, topologyDefinition(name));
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.rowAction(collection.name, 'Add Topology');
    const dialog = new Dialog(page, 'Add Topology');
    await dialog.fill('Topology Name', name);
    await dialog.button('Apply').click();

    await expect(dialog.validationError()).toHaveText(
      'A topology with that name already exists in this collection.',
    );
  });

  test('a topology can be renamed', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const newName = uniqueName('renamed');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(name),
    );
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(collection.name);

    await editor.explorer.rowAction(name, 'Edit Topology');
    const dialog = new Dialog(page, 'Edit Topology');
    await dialog.fill('Topology Name', newName);
    await dialog.button('Apply').click();

    await expect(
      toast(page, 'Topology has been updated successfully.'),
    ).toBeVisible();
    await expect(editor.explorer.row(newName)).toBeVisible();

    const topology = await api.getTopology(topologyId);
    expect(topology.definition).toContain(`name: ${newName}`);
  });

  test('a topology can be duplicated', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    await api.createTopology(collection.id, topologyDefinition(name));
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(collection.name);

    await editor.explorer.rowAction(name, 'Duplicate Topology');

    await expect(
      toast(page, 'Topology has been duplicated successfully.'),
    ).toBeVisible();
    await expect(editor.explorer.row(`${name} (clone)`)).toBeVisible();

    const topologies = await api.getTopologies();
    expect(
      topologies.filter(t => t.definition.includes(`name: ${name} (clone)`)),
    ).toHaveLength(1);
  });

  test('a topology can be deleted', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(name),
    );
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(collection.name);

    await editor.explorer.rowAction(name, 'Delete Topology');
    const confirm = new ConfirmDialog(page);
    await expect(confirm.root).toContainText(`Delete Topology "${name}"?`);
    await confirm.accept();

    await expect(toast(page, 'Topology has been deleted.')).toBeVisible();
    await expect(editor.explorer.row(name)).toBeHidden();

    const topologies = await api.getTopologies();
    expect(topologies.map(t => t.id)).not.toContain(topologyId);
  });

  test('a deep link opens the topology', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(name),
    );
    const editor = new EditorPage(page);

    await editor.goto(topologyId);

    await expect.poll(() => editorText(editor.editor.monaco)).toContain(name);
  });

  test('edits are saved and survive a reload', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(name),
    );
    const editor = new EditorPage(page);
    await editor.goto(topologyId);
    await expect.poll(() => editorText(editor.editor.monaco)).toContain(name);

    await setEditorText(
      editor.editor.monaco,
      topologyDefinition(name, ['host1', 'router1']),
    );

    // Unsaved edits are marked on the save button and in the page title
    await expect(editor.editor.unsavedBadge).toBeVisible();
    await expect(page).toHaveTitle(/\*$/);

    await expect(editor.editor.saveButton).toBeEnabled();
    await editor.editor.save();

    await expect(editor.editor.unsavedBadge).toBeHidden();
    await expect(editor.editor.saveButton).toBeDisabled();
    await expect(page).not.toHaveTitle(/\*$/);
    expect((await api.getTopology(topologyId)).definition).toContain('router1');

    await page.reload();
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('router1');
  });

  test('an invalid topology cannot be saved', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(name),
    );
    const editor = new EditorPage(page);
    await editor.goto(topologyId);
    await expect(editor.editor.validationStatus).toHaveAttribute(
      'data-validation-state',
      'done',
    );

    await setEditorText(
      editor.editor.monaco,
      `name: ${name}\ntopology:\n  nodes:\n    host1:\n      kind: not-a-kind\n`,
    );

    await expect(editor.editor.validationStatus).toHaveAttribute(
      'data-validation-state',
      'error',
    );
    await expect(editor.editor.saveButton).toBeDisabled();
    expect((await api.getTopology(topologyId)).definition).not.toContain(
      'not-a-kind',
    );
  });

  test('edits can be undone and redone', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(name),
    );
    const editor = new EditorPage(page);
    await editor.goto(topologyId);
    await expect.poll(() => editorText(editor.editor.monaco)).toContain(name);

    await setEditorText(
      editor.editor.monaco,
      topologyDefinition(name, ['host1', 'router1']),
    );
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('router1');

    await editor.editor.button('Undo').click();
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .not.toContain('router1');

    await editor.editor.button('Redo').click();
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('router1');
  });

  test('a topology can be downloaded', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(name),
    );
    const editor = new EditorPage(page);
    await editor.goto(topologyId);
    await expect.poll(() => editorText(editor.editor.monaco)).toContain(name);

    const downloadPromise = page.waitForEvent('download');
    await editor.editor.button('Download').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(
      `${collection.name}_${name}.yaml`,
    );
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toContain(`name: ${name}`);
  });

  test('switching files with unsaved edits asks for confirmation', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const first = uniqueName('topology');
    const second = uniqueName('topology');
    const firstId = await api.createTopology(
      collection.id,
      topologyDefinition(first),
    );
    await api.createTopology(collection.id, topologyDefinition(second));
    const editor = new EditorPage(page);
    await editor.goto(firstId);
    await expect.poll(() => editorText(editor.editor.monaco)).toContain(first);
    await setEditorText(
      editor.editor.monaco,
      topologyDefinition(first, ['host1', 'router1']),
    );
    await expect(editor.editor.unsavedBadge).toBeVisible();

    await editor.explorer.expand(collection.name);
    await editor.explorer.open(second);

    const confirm = new ConfirmDialog(page);
    await expect(confirm.root).toContainText('Discard unsaved changes?');
    await confirm.accept();

    await expect.poll(() => editorText(editor.editor.monaco)).toContain(second);
  });
});
