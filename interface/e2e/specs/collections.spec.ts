import {expect, test} from '../fixtures/test';
import {ConfirmDialog, toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/*
 * Creating, editing and deleting collections in the editor's explorer, as the admin. What other users
 * may do with collections is in permissions.spec.ts.
 */

test('an admin can create a collection with its public flags', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  // With at least one topology the explorer is shown instead of the setup screen
  await createTopology();
  const name = uniqueName('collection');
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.backgroundMenu('New collection');
  const dialog = editor.explorer.collectionDialog('New collection');
  await dialog.fill('Name', name);
  await editor.explorer.setCollectionFlag(dialog, 'publicdeploy', true);
  await dialog.submit('Create');

  await expect(
    toast(page, 'Collection has been created successfully.'),
  ).toBeVisible();
  await expect(editor.explorer.row(name)).toBeVisible();

  const collection = (await api.getCollections()).find(c => c.name === name);
  expect(collection).toMatchObject({publicDeploy: true, publicWrite: false});
  await api.deleteCollection(collection!.id);
});

test('the setup screen creates the first collection', async ({
  page,
  api,
  uniqueName,
}) => {
  // The setup screen only shows when there are no topologies at all
  test.skip(
    (await api.getTopologies()).length > 0,
    'other topologies exist on the server',
  );
  const name = uniqueName('collection');
  await new EditorPage(page).goto();

  await page.getByRole('button', {name: 'New collection'}).click();
  const dialog = new EditorPage(page).explorer.collectionDialog(
    'New collection',
  );
  await dialog.fill('Name', name);
  await dialog.submit('Create');

  await expect(
    toast(page, 'Collection has been created successfully.'),
  ).toBeVisible();
  const collection = (await api.getCollections()).find(c => c.name === name);
  expect(collection).toBeDefined();
  await api.deleteCollection(collection!.id);
});

test('a collection needs a unique name', async ({page, createTopology}) => {
  const existing = await createTopology();
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.backgroundMenu('New collection');
  const dialog = editor.explorer.collectionDialog('New collection');
  await dialog.submit('Create');
  await expect(dialog.validationError()).toContainText("Name can't be empty");

  await dialog.fill('Name', existing.collection.name);
  await dialog.submit('Create');
  await expect(dialog.validationError()).toContainText(
    'A collection with that name already exists.',
  );
  await expect(dialog.root).toBeVisible();
});

test('a collection can be renamed and its flags changed', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const topology = await createTopology();
  const newName = uniqueName('renamed');
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.menu(topology.collection.name, 'Edit');
  const dialog = editor.explorer.collectionDialog('Edit collection');
  await expect(dialog.field('Name')).toHaveValue(topology.collection.name);
  await dialog.fill('Name', newName);
  await editor.explorer.setCollectionFlag(dialog, 'publicwrite', true);
  await dialog.submit('Save');

  await expect(
    toast(page, 'Collection has been updated successfully.'),
  ).toBeVisible();
  await expect(editor.explorer.row(newName)).toBeVisible();
  const collection = (await api.getCollections()).find(
    c => c.id === topology.collection.id,
  );
  expect(collection).toMatchObject({name: newName, publicWrite: true});
});

test('the "…" button opens the collection menu', async ({
  page,
  createTopology,
}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.row(topology.collection.name).hover();
  await editor.explorer
    .rowButton(topology.collection.name, 'Edit Collection')
    .click();

  await expect(
    page.locator('.p-contextmenu').filter({visible: true}),
  ).toContainText('Delete');
});

test('deleting a collection deletes its topologies', async ({
  page,
  api,
  createTopology,
}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.menu(topology.collection.name, 'Delete');
  const confirm = new ConfirmDialog(page);
  await expect(confirm.header).toHaveText(
    `Delete Collection "${topology.collection.name}"?`,
  );
  // The confirmation lists what gets deleted with it
  await expect(confirm.root).toContainText(topology.name);
  await confirm.accept();

  await expect(toast(page, 'Collection has been deleted.')).toBeVisible();
  await expect(editor.explorer.row(topology.collection.name)).toBeHidden();
  expect((await api.getCollections()).map(c => c.id)).not.toContain(
    topology.collection.id,
  );
  expect((await api.getTopologies()).map(t => t.id)).not.toContain(topology.id);
});

test('a collection with a running lab can not be deleted', async ({
  page,
  api,
  createLab,
}) => {
  const lab = await createLab({deployed: true});
  const editor = new EditorPage(page);
  await editor.goto();

  await editor.explorer.menu(lab.topology.collection.name, 'Delete');
  await new ConfirmDialog(page).accept();

  await expect(page.locator('.p-toast-message-error')).toBeVisible();
  expect((await api.getCollections()).map(c => c.id)).toContain(
    lab.topology.collection.id,
  );
});
