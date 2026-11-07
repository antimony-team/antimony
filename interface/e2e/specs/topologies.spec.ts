import {readFile} from 'node:fs/promises';

import {topologyDefinition} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {ConfirmDialog, toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/*
 * Creating, renaming, duplicating, moving and deleting topologies in the explorer, as the admin.
 */

test('a topology can be added to a collection', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const existing = await createTopology();
  const name = uniqueName('topology');
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.row(existing.collection.name).hover();
  await editor.explorer
    .rowButton(existing.collection.name, 'Add topology')
    .click();
  const dialog = editor.explorer.topologyDialog('Add topology');
  await editor.explorer.waitForDialogCollection(
    dialog,
    existing.collection.name,
  );
  await dialog.fill('Name', name);
  await dialog.submit('Apply');

  await expect(
    toast(page, 'Topology has been created successfully.'),
  ).toBeVisible();
  await editor.explorer.expand(existing.collection.name);
  await expect(editor.explorer.row(name)).toBeVisible();

  // New topologies start from a template with two SR Linux nodes
  const created = (await api.getTopologies()).find(t =>
    t.definition.includes(`name: ${name}`),
  );
  expect(created?.collectionId).toBe(existing.collection.id);
  expect(created?.definition).toContain('nokia_srlinux');
  await api.deleteTopology(created!.id);
});

test('a topology can be added with the collection menu', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const existing = await createTopology();
  const name = uniqueName('topology');
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.menu(existing.collection.name, 'New topology');
  const dialog = editor.explorer.topologyDialog('Add topology');
  await editor.explorer.waitForDialogCollection(
    dialog,
    existing.collection.name,
  );
  await dialog.fill('Name', name);
  await dialog.submit('Apply');

  await editor.explorer.expand(existing.collection.name);
  await expect(editor.explorer.row(name)).toBeVisible();
  const created = (await api.getTopologies()).find(t =>
    t.definition.includes(`name: ${name}`),
  );
  await api.deleteTopology(created!.id);
});

test.describe('topology names', () => {
  test('a topology needs a name', async ({page, createTopology}) => {
    const existing = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.menu(existing.collection.name, 'New topology');
    const dialog = editor.explorer.topologyDialog('Add topology');
    await dialog.submit('Apply');

    await expect(dialog.validationError()).toBeVisible();
    await expect(dialog.root).toBeVisible();
  });

  test('topology names are unique within a collection', async ({
    page,
    createTopology,
  }) => {
    const existing = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.menu(existing.collection.name, 'New topology');
    const dialog = editor.explorer.topologyDialog('Add topology');
    await editor.explorer.waitForDialogCollection(
      dialog,
      existing.collection.name,
    );
    await dialog.fill('Name', existing.name);
    await dialog.submit('Apply');

    await expect(dialog.validationError()).toContainText(
      'A topology with that name already exists',
    );
  });

  test('topology names can not contain spaces', async ({
    page,
    createTopology,
  }) => {
    const existing = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.menu(existing.collection.name, 'New topology');
    const dialog = editor.explorer.topologyDialog('Add topology');
    await editor.explorer.waitForDialogCollection(
      dialog,
      existing.collection.name,
    );
    await dialog.fill('Name', 'with space');
    await dialog.submit('Apply');

    await expect(dialog.validationError()).toContainText(
      'This name contains illegal characters.',
    );
  });
});

test('a topology can be renamed', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const topology = await createTopology();
  const newName = uniqueName('renamed');
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  await editor.explorer.menu(topology.name, 'Edit');
  const dialog = editor.explorer.topologyDialog('Edit topology');
  await expect(dialog.field('Name')).toHaveValue(topology.name);
  await dialog.fill('Name', newName);
  await dialog.submit('Apply');

  await expect(
    toast(page, 'Topology has been updated successfully.'),
  ).toBeVisible();
  await expect(editor.explorer.row(newName)).toBeVisible();
  expect((await api.getTopology(topology.id)).definition).toContain(
    `name: ${newName}`,
  );
});

test('a topology can be moved to another collection in its dialog', async ({
  page,
  api,
  createCollection,
  createTopology,
}) => {
  const topology = await createTopology();
  const target = await createCollection();
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  await editor.explorer.menu(topology.name, 'Edit');
  const dialog = editor.explorer.topologyDialog('Edit topology');
  await dialog.select('Collection', target.name);
  await dialog.submit('Apply');

  await expect(
    toast(page, 'Topology has been updated successfully.'),
  ).toBeVisible();
  expect((await api.getTopology(topology.id)).collectionId).toBe(target.id);
});

test('a topology can be duplicated with its annotations', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const topology = await createTopology({nodes: ['a', 'b']});
  const copyName = uniqueName('copy');
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  await editor.explorer.menu(topology.name, 'Duplicate');
  const dialog = editor.explorer.topologyDialog('Duplicate topology');
  // The suggested name is a free variant of the original's
  await expect(dialog.field('Name')).toHaveValue(
    new RegExp(`^${topology.name}-\\d+$`),
  );
  await dialog.fill('Name', copyName);
  await dialog.submit('Apply');

  await expect(
    toast(page, 'Topology has been created successfully.'),
  ).toBeVisible();
  const copy = (await api.getTopologies()).find(t =>
    t.definition.includes(`name: ${copyName}`),
  );
  expect(copy?.collectionId).toBe(topology.collection.id);
  expect(JSON.parse(copy!.annotations).nodeAnnotations).toEqual(
    (await api.getAnnotations(topology.id)).nodeAnnotations,
  );
  await api.deleteTopology(copy!.id);
});

test('a topology can be deleted', async ({page, api, createTopology}) => {
  const topology = await createTopology();
  const other = await createTopology({collection: topology.collection});
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  await editor.explorer.menu(topology.name, 'Delete');
  const confirm = new ConfirmDialog(page);
  await expect(confirm.root).toContainText(
    `Are you sure you want to delete the topology "${topology.name}"?`,
  );
  await confirm.accept('Delete topology');

  await expect(toast(page, 'Topology has been deleted.')).toBeVisible();
  await expect(editor.explorer.row(topology.name)).toBeHidden();
  await expect(editor.explorer.row(other.name)).toBeVisible();
  expect((await api.getTopologies()).map(t => t.id)).not.toContain(topology.id);
});

test('a topology can be dragged into another collection', async ({
  page,
  api,
  createCollection,
  createTopology,
}) => {
  const topology = await createTopology();
  const target = await createCollection();
  // The target needs a topology to be shown in the tree
  await createTopology({collection: target});
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  await editor.explorer
    .row(topology.name)
    .dragTo(editor.explorer.row(target.name));

  await expect
    .poll(async () => (await api.getTopology(topology.id)).collectionId)
    .toBe(target.id);
});

test('moving a topology leaves the open topology alone', async ({
  page,
  api,
  createCollection,
  createTopology,
}) => {
  const open = await createTopology();
  const moved = await createTopology({collection: open.collection});
  const target = await createCollection();
  await createTopology({collection: target});
  const editor = new EditorPage(page);
  await editor.open(open.id, open.name);
  await editor.explorer.expand(open.collection.name);

  await editor.explorer
    .row(moved.name)
    .dragTo(editor.explorer.row(target.name));
  await expect
    .poll(async () => (await api.getTopology(moved.id)).collectionId)
    .toBe(target.id);

  await expect(editor.editor.title).toHaveText(new RegExp(`${open.name}$`));
  expect(await editor.editor.text()).toContain(`name: ${open.name}`);
});

test('moving the open topology keeps its unsaved edits', async ({
  page,
  api,
  createCollection,
  createTopology,
}) => {
  const open = await createTopology();
  const target = await createCollection();
  await createTopology({collection: target});
  const editor = new EditorPage(page);
  await editor.open(open.id, open.name);
  await editor.editor.setText(
    topologyDefinition(open.name, ['host1', 'host2', 'unsaved']),
  );
  await expect(editor.editor.title).toHaveText(new RegExp(`${open.name}\\*$`));
  await editor.explorer.expand(open.collection.name);

  await editor.explorer.row(open.name).dragTo(editor.explorer.row(target.name));
  await expect
    .poll(async () => (await api.getTopology(open.id)).collectionId)
    .toBe(target.id);

  await expect.poll(() => editor.editor.text()).toContain('unsaved:');
});

test('the explorer filter shows only matching topologies', async ({
  page,
  createTopology,
}) => {
  const match = await createTopology();
  const other = await createTopology({collection: match.collection});
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(match.collection.name);

  await editor.explorer.filter.fill(match.name);

  await expect(editor.explorer.row(match.name)).toBeVisible();
  await expect(editor.explorer.row(other.name)).toBeHidden();
});

test('a deep link opens the topology and a click opens another', async ({
  page,
  createTopology,
}) => {
  const first = await createTopology();
  const second = await createTopology({collection: first.collection});
  const editor = new EditorPage(page);

  await editor.open(first.id, first.name);
  await expect(editor.editor.crumbs).toContainText(first.collection.name);
  expect(await editor.editor.text()).toContain(`name: ${first.name}`);

  await editor.explorer.expand(first.collection.name);
  await editor.explorer.open(second.name);
  await editor.editor.waitForTitle(second.name);
  await expect(page).toHaveURL(new RegExp(`f=${second.id}`));
});

test('Download YAML in the topology menu downloads the topology', async ({
  page,
  api,
  createTopology,
}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  const download = page.waitForEvent('download', {timeout: 5000});
  await editor.explorer.menu(topology.name, 'Download YAML');

  expect((await download).suggestedFilename()).toBe(
    `${topology.collection.name}_${topology.name}.yaml`,
  );
  expect(await readFile(await (await download).path(), 'utf-8')).toBe(
    (await api.getTopology(topology.id)).definition,
  );
});

test('Download YAML downloads the saved version of an open topology with edits', async ({
  page,
  createTopology,
}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);
  await editor.editor.setText(
    topologyDefinition(topology.name, ['host1', 'host2', 'unsaved']),
  );
  await expect(editor.editor.title).toHaveText(
    new RegExp(`${topology.name}\\*$`),
  );
  await editor.explorer.expand(topology.collection.name);

  const download = page.waitForEvent('download', {timeout: 5000});
  await editor.explorer.menu(topology.name, 'Download YAML');

  expect(await readFile(await (await download).path(), 'utf-8')).not.toContain(
    'unsaved:',
  );
  await expect.poll(() => editor.editor.text()).toContain('unsaved:');
});
