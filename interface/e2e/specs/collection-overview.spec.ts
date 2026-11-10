import {expect, test} from '../fixtures/test';
import {EditorPage} from '../pages/editor-page';

/*
 * The overview of a collection, opened in a tab by clicking the collection in the explorer: its
 * topologies, its running labs and what can be done with it.
 */

test('a collection opens as a tab with its topologies and running labs', async ({
  page,
  createCollection,
  createTopology,
  createLab,
}) => {
  const collection = await createCollection();
  const first = await createTopology({collection});
  const second = await createTopology({collection});
  const lab = await createLab({topology: first, deployed: true});

  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.open(collection.name);

  await expect(editor.editor.tab(collection.name)).toBeVisible();
  await expect(
    page.getByRole('heading', {level: 1, name: collection.name}),
  ).toBeVisible();

  const topologies = page.getByRole('region', {name: 'Topologies'});
  await expect(topologies.getByRole('button')).toHaveCount(2);
  await expect(
    page.getByRole('region', {name: 'Running labs'}).getByRole('button', {
      name: new RegExp(lab.name),
    }),
  ).toBeVisible();

  await topologies.getByRole('button', {name: new RegExp(second.name)}).click();
  await expect(editor.editor.title).toHaveText(new RegExp(`${second.name}$`));
});

test('an empty collection offers to create its first topology', async ({
  page,
  createCollection,
  createTopology,
}) => {
  // Without any topology, the editor shows its setup instead of the explorer
  await createTopology();
  const collection = await createCollection();
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.open(collection.name);

  const topologies = page.getByRole('region', {name: 'Topologies'});
  await expect(topologies.getByText('No topologies yet')).toBeVisible();
  await topologies.getByRole('button', {name: 'New topology'}).click();
  await expect(
    editor.explorer.topologyDialog('Add topology').root,
  ).toBeVisible();
});

test('the edit button of a collection opens its dialog', async ({
  page,
  createCollection,
  createTopology,
}) => {
  // Without any topology, the editor shows its setup instead of the explorer
  await createTopology();
  const collection = await createCollection();
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.open(collection.name);

  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  const dialog = editor.explorer.collectionDialog('Edit collection');
  await expect(dialog.field('Name')).toHaveValue(collection.name);
});
