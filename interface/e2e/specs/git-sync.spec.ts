import {topologyDefinition} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {editorText} from '../helpers/monaco';
import {toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/*
 * The sync URL is fetched by the browser, so the tests serve it with page.route instead of a real
 * server. The URL never has to exist.
 */
const SYNC_URL = 'https://sync.e2e.invalid/topology.yaml';

test.describe('git sync', () => {
  test('a topology can be fetched from its sync URL', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.route(SYNC_URL, route =>
      route.fulfill({
        contentType: 'text/yaml',
        body: topologyDefinition(topology.name, ['synced1', 'synced2']),
      }),
    );
    const editor = new EditorPage(page);
    await editor.goto(topology.id);
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain(topology.name);

    await editor.editor.button('Sync Options').click();
    const overlay = page.locator('.sync-overlay-panel');
    await overlay.getByLabel('Sync URL', {exact: true}).fill(SYNC_URL);

    // Fetching is only possible once the topology has a saved sync URL
    await expect(overlay.getByRole('button', {name: 'Fetch'})).toBeDisabled();
    await overlay.getByRole('button', {name: 'Save Sync URL'}).click();
    await overlay.getByRole('button', {name: 'Fetch'}).click();

    // The fetched definition replaces the editor content as unsaved edits
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('synced2');
    await expect(editor.editor.unsavedBadge).toBeVisible();
  });

  test('the sync URL is saved with the topology', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.route(SYNC_URL, route =>
      route.fulfill({
        contentType: 'text/yaml',
        body: topologyDefinition(topology.name),
      }),
    );
    const editor = new EditorPage(page);
    await editor.goto(topology.id);

    await editor.editor.button('Sync Options').click();
    const overlay = page.locator('.sync-overlay-panel');
    await overlay.getByLabel('Sync URL', {exact: true}).fill(SYNC_URL);
    await overlay.getByRole('button', {name: 'Save Sync URL'}).click();

    await expect(
      toast(page, 'Sync URL has been updated successfully.'),
    ).toBeVisible();
    expect((await api.getTopology(topology.id)).syncUrl).toBe(SYNC_URL);
  });

  test('an invalid URL is not saved', async ({page, api, createTopology}) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto(topology.id);

    await editor.editor.button('Sync Options').click();
    const overlay = page.locator('.sync-overlay-panel');
    await overlay.getByLabel('Sync URL', {exact: true}).fill('not a url');
    await overlay.getByRole('button', {name: 'Save Sync URL'}).click();

    await expect(page.locator('.sb-input-validation-tooltip')).toHaveText(
      'Specified URL is not valid',
    );
    expect((await api.getTopology(topology.id)).syncUrl).toBe('');
  });

  test('an unreachable URL is not saved', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.route(SYNC_URL, route => route.fulfill({status: 404}));
    const editor = new EditorPage(page);
    await editor.goto(topology.id);

    await editor.editor.button('Sync Options').click();
    const overlay = page.locator('.sync-overlay-panel');
    await overlay.getByLabel('Sync URL', {exact: true}).fill(SYNC_URL);
    await overlay.getByRole('button', {name: 'Save Sync URL'}).click();

    await expect(page.locator('.sb-input-validation-tooltip')).toHaveText(
      'Unable to fetch from the provided resource.',
    );
    expect((await api.getTopology(topology.id)).syncUrl).toBe('');
  });
});
