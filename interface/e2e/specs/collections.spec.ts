import {topologyDefinition} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {ConfirmDialog, Dialog, toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

test.describe('collections', () => {
  test('an admin can create a collection', async ({page, api, uniqueName}) => {
    const name = uniqueName('collection');
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.addCollectionButton.click();
    const dialog = new Dialog(page, 'Add Collection');
    await dialog.fill('Collection Name', name);
    await dialog.button('Apply').click();

    await expect(
      toast(page, 'Collection has been created successfully.'),
    ).toBeVisible();
    await expect(dialog.root).toBeHidden();
    await expect(editor.explorer.row(name)).toBeVisible();

    const collections = await api.getCollections();
    expect(collections.map(collection => collection.name)).toContain(name);
  });

  test('the public flags are stored with the collection', async ({
    page,
    api,
    uniqueName,
  }) => {
    const name = uniqueName('collection');
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.addCollectionButton.click();
    const dialog = new Dialog(page, 'Add Collection');
    await dialog.fill('Collection Name', name);
    await dialog.field('Public Deploy').check();
    await dialog.field('Public Write').check();
    await dialog.button('Apply').click();

    await expect(dialog.root).toBeHidden();
    const created = (await api.getCollections()).find(c => c.name === name);
    expect(created).toMatchObject({publicDeploy: true, publicWrite: true});
  });

  test('an empty name is rejected', async ({page}) => {
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.addCollectionButton.click();
    const dialog = new Dialog(page, 'Add Collection');
    await dialog.button('Apply').click();

    await expect(dialog.validationError()).toHaveText("Name can't be empty");
    await expect(dialog.root).toBeVisible();
  });

  test('a duplicate name is rejected', async ({page, createCollection}) => {
    const existing = await createCollection();
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.addCollectionButton.click();
    const dialog = new Dialog(page, 'Add Collection');
    await dialog.fill('Collection Name', existing.name);
    await dialog.button('Apply').click();

    await expect(dialog.validationError()).toHaveText(
      'A collection with that name already exists.',
    );
    await expect(dialog.root).toBeVisible();
  });

  test('a collection can be renamed', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const newName = uniqueName('renamed');
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.rowAction(collection.name, 'Edit Collection');
    const dialog = new Dialog(page, 'Edit Collection');
    await expect(dialog.field('Collection Name')).toHaveValue(collection.name);
    await dialog.fill('Collection Name', newName);
    await dialog.button('Apply').click();

    await expect(
      toast(page, 'Collection has been updated successfully.'),
    ).toBeVisible();
    await expect(editor.explorer.row(newName)).toBeVisible();
    await expect(editor.explorer.row(collection.name)).toBeHidden();

    const renamed = (await api.getCollections()).find(
      c => c.id === collection.id,
    );
    expect(renamed?.name).toBe(newName);
  });

  test('an empty collection can be deleted', async ({
    page,
    api,
    createCollection,
  }) => {
    const collection = await createCollection();
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.rowAction(collection.name, 'Delete Collection');
    const confirm = new ConfirmDialog(page);
    await expect(confirm.root).toContainText(
      `Delete Collection "${collection.name}"?`,
    );
    await confirm.accept();

    await expect(toast(page, 'Collection has been deleted.')).toBeVisible();
    await expect(editor.explorer.row(collection.name)).toBeHidden();

    const collections = await api.getCollections();
    expect(collections.map(c => c.id)).not.toContain(collection.id);
  });

  test('deleting a collection deletes its topologies, as the dialog says', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    test.fail(
      true,
      'Known bug: the backend only soft-deletes the collection and keeps its topologies',
    );

    const collection = await createCollection();
    const topologyName = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      topologyDefinition(topologyName),
    );
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.rowAction(collection.name, 'Delete Collection');
    const confirm = new ConfirmDialog(page);
    await expect(confirm.root).toContainText(
      'The following topologies will be deleted',
    );
    await expect(confirm.root).toContainText(topologyName);
    await confirm.accept();

    await expect(toast(page, 'Collection has been deleted.')).toBeVisible();

    const topologies = await api.getTopologies();
    expect(topologies.map(topology => topology.id)).not.toContain(topologyId);
  });
});
