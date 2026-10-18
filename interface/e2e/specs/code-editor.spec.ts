import {topologyDefinition} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {graphNodes} from '../helpers/cytoscape';
import {toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/*
 * The code side of the topology editor: the YAML and annotation files, validation, saving, undo, the
 * view modes, downloads and the sync URL.
 */

test('an edit marks the topology as unsaved until it is saved', async ({
  page,
  api,
  createTopology,
}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);
  const code = editor.editor;
  await expect(code.save).toBeDisabled();
  await expect(code.unsavedDot).toBeHidden();

  await code.setText(
    topologyDefinition(topology.name, ['host1', 'host2', 'host3']),
  );
  // Saving waits for the validation, which runs shortly after typing stops
  await expect(code.validation).toHaveAttribute(
    'data-validation-state',
    'done',
  );

  await expect(code.title).toHaveText(new RegExp(`${topology.name}\\*$`));
  await expect(page).toHaveTitle(`Antimony | ${topology.name}*`);
  await expect(code.unsavedDot).toBeVisible();
  await expect(code.save).toBeEnabled();

  await code.saveWithKeyboard();

  await expect(code.title).toHaveText(new RegExp(`${topology.name}$`));
  await expect(code.unsavedDot).toBeHidden();
  await expect
    .poll(async () => (await api.getTopology(topology.id)).definition)
    .toContain('host3:');

  // The new node gets a position in the annotations when saving
  const annotations = await api.getAnnotations(topology.id);
  expect(annotations.nodeAnnotations?.map(n => n.id)).toContain('host3');

  await page.reload();
  await code.waitForTitle(topology.name);
  expect(await code.text()).toContain('host3:');
});

test('an invalid topology shows an error and can not be saved', async ({
  page,
  createTopology,
}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);
  const code = editor.editor;
  await expect(code.validation).toHaveAttribute(
    'data-validation-state',
    'done',
  );
  await expect(code.validation).toHaveText('Valid');

  await code.setText(
    `name: ${topology.name}\ntopology:\n  nodes:\n    host1:\n      kind: 42\n`,
  );

  await expect(code.validation).toHaveAttribute(
    'data-validation-state',
    'error',
  );
  await expect(code.validation).toHaveText('Error');
  await expect(code.save).toBeDisabled();
});

test('the footer counts nodes, links and annotations', async ({
  page,
  createTopology,
}) => {
  const topology = await createTopology({nodes: ['a', 'b', 'c']});
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);

  // The dots between the parts are drawn with CSS
  await expect(editor.editor.stats).toContainText('3 nodes');
  await expect(editor.editor.stats).toContainText('2 links');
  await expect(editor.editor.stats).toContainText('0 annotations');
});

test('edits can be undone and redone', async ({page, createTopology}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);
  const code = editor.editor;
  await expect(code.undo).toBeDisabled();

  await code.setText(topologyDefinition(topology.name, ['solo']));
  await expect(code.undo).toBeEnabled();

  await code.undo.click();
  await expect.poll(() => code.text()).toContain('host2:');
  await expect(code.redo).toBeEnabled();

  await code.redo.click();
  await expect.poll(() => code.text()).toContain('solo:');
});

test('leaving a topology with unsaved edits asks first', async ({
  page,
  createTopology,
}) => {
  const first = await createTopology();
  const second = await createTopology({collection: first.collection});
  const editor = new EditorPage(page);
  await editor.open(first.id, first.name);
  await editor.editor.setText(topologyDefinition(first.name, ['changed']));
  await expect(editor.editor.title).toHaveText(new RegExp(`${first.name}\\*$`));

  await editor.explorer.expand(first.collection.name);
  await editor.explorer.open(second.name);
  await editor.editor.discardChanges(false);
  await expect(editor.editor.title).toHaveText(new RegExp(`${first.name}\\*$`));

  await editor.explorer.open(second.name);
  await editor.editor.discardChanges(true);
  await editor.editor.waitForTitle(second.name);
  await expect(editor.editor.title).toHaveText(new RegExp(`${second.name}$`));
});

test.describe('views', () => {
  test('the editor shows code, graph or both', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);
    const code = editor.editor;

    await code.view('Code').click();
    await expect(code.view('Code')).toHaveAttribute('aria-checked', 'true');
    await expect(code.monaco).toBeVisible();
    await expect(editor.graph.canvas).toBeHidden();

    await code.view('Graph').click();
    await expect(editor.graph.canvas).toBeVisible();
    await expect(code.monaco).toBeHidden();
    await expect.poll(() => graphNodes(editor.graph.canvas)).toHaveLength(2);

    await code.view('Split').click();
    await expect(code.monaco).toBeVisible();
    await expect(editor.graph.canvas).toBeVisible();
  });

  test('the chosen view is kept after a reload', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);

    await editor.editor.view('Graph').click();
    await page.reload();
    await editor.editor.waitForTitle(topology.name);

    await expect(editor.editor.view('Graph')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

test.describe('annotations file', () => {
  test('the annotations of a topology can be viewed and edited', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b']});
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);
    const code = editor.editor;
    await code.view('Code').click();

    await code.switchFile('Annotations');
    await expect(code.fileSwitch).toContainText('Annotations');
    await expect.poll(() => code.text()).toContain('nodeAnnotations');

    const annotations = {
      nodeAnnotations: [
        {id: 'a', position: {x: 0, y: 0}},
        {id: 'b', position: {x: 500, y: 0}},
      ],
      freeTextAnnotations: [
        {id: 'text-1', text: 'Hello', position: {x: 100, y: 100}},
      ],
    };
    await code.setText(JSON.stringify(annotations, null, 2));
    await expect(code.title).toHaveText(new RegExp(`${topology.name}\\*$`));
    await code.save.click();

    await expect
      .poll(
        async () => (await api.getAnnotations(topology.id)).freeTextAnnotations,
      )
      .toEqual([expect.objectContaining({id: 'text-1', text: 'Hello'})]);

    await code.switchFile('Topology');
    await expect.poll(() => code.text()).toContain(`name: ${topology.name}`);
  });

  test('invalid annotations are not accepted', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);
    const code = editor.editor;
    await code.view('Code').click();
    await code.switchFile('Annotations');

    await code.setText('{"nodeAnnotations": [{"position": 5}]}');

    await expect(code.validation).toHaveAttribute(
      'data-validation-state',
      'error',
    );
    await expect(code.save).toBeDisabled();
  });
});

test.describe('downloads', () => {
  test('the topology can be downloaded as YAML', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);

    const download = page.waitForEvent('download');
    await editor.editor.download.click();

    expect((await download).suggestedFilename()).toBe(
      `${topology.collection.name}_${topology.name}.yaml`,
    );
  });

  test('the annotations can be downloaded as JSON', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);
    await editor.editor.switchFile('Annotations');

    const download = page.waitForEvent('download');
    await editor.editor.download.click();

    expect((await download).suggestedFilename()).toBe(
      `${topology.collection.name}_${topology.name}.annotations.json`,
    );
  });
});

test.describe('sync URL', () => {
  const SYNC_URL = 'https://sync.example.test/topology.yaml';

  test('a topology can be fetched from its saved sync URL', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.route(SYNC_URL, route =>
      route.fulfill({
        body: topologyDefinition(topology.name, ['synced']),
        contentType: 'text/plain',
        headers: {'Access-Control-Allow-Origin': '*'},
      }),
    );
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);
    await editor.editor.view('Code').click();

    await editor.editor.syncOptions.click();
    const overlay = page.locator('.sync-overlay-panel');
    // Fetching needs a saved URL
    await expect(overlay.getByRole('button', {name: 'Fetch'})).toBeDisabled();
    await overlay.locator('#sync-url').fill(SYNC_URL);
    await overlay.getByRole('button', {name: 'Save sync URL'}).click();
    await expect(
      toast(page, 'Sync URL has been updated successfully.'),
    ).toBeVisible();
    await expect
      .poll(async () => (await api.getTopology(topology.id)).syncUrl)
      .toBe(SYNC_URL);

    await overlay.getByRole('button', {name: 'Fetch'}).click();
    await expect.poll(() => editor.editor.text()).toContain('synced:');
    await expect(editor.editor.title).toHaveText(
      new RegExp(`${topology.name}\\*$`),
    );
  });

  test('an unreachable sync URL is not saved', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.route(SYNC_URL, route => route.abort());
    const editor = new EditorPage(page);
    await editor.open(topology.id, topology.name);

    await editor.editor.syncOptions.click();
    const overlay = page.locator('.sync-overlay-panel');
    await overlay.locator('#sync-url').fill(SYNC_URL);
    await overlay.getByRole('button', {name: 'Save sync URL'}).click();

    await expect(
      page.getByRole('tooltip').filter({visible: true}),
    ).toBeVisible();
    expect((await api.getTopology(topology.id)).syncUrl).toBe('');
  });
});
