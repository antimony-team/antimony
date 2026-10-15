import {AntimonyApi} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {editorText, setEditorText} from '../helpers/monaco';
import {ConfirmDialog, Dialog, toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/** The bind file paths of a topology, as stored by the backend. */
async function filePaths(api: AntimonyApi, topologyId: string) {
  const topology = await api.getTopology(topologyId);

  return topology.bindFiles.map(file => file.filePath).sort();
}

test.describe('bind files', () => {
  test('a file can be added to a topology', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);

    await editor.explorer.rowAction(topology.name, 'Add File');
    const dialog = new Dialog(page, 'Add File');
    await dialog.fill('File Path', 'startup.cfg');
    await dialog.button('Apply').click();

    await expect(
      toast(page, 'File has been created successfully.'),
    ).toBeVisible();
    await editor.explorer.expand(topology.name);
    await expect(editor.explorer.row('startup.cfg')).toBeVisible();
    expect(await filePaths(api, topology.id)).toEqual(['startup.cfg']);
  });

  test('a nested path creates directories', async ({page, createTopology}) => {
    const topology = await createTopology({
      files: {
        'node1/config/startup.cfg': '',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();

    await editor.explorer.expand(
      topology.collection.name,
      topology.name,
      'node1',
      'config',
    );

    await expect(editor.explorer.row('startup.cfg')).toBeVisible();
  });

  test('the content of a file can be edited and saved', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({files: {'startup.cfg': 'old'}});
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);

    await editor.explorer.open('startup.cfg');
    await expect.poll(() => editorText(editor.editor.monaco)).toBe('old');
    await setEditorText(editor.editor.monaco, 'hostname router1');
    await expect(editor.editor.unsavedBadge).toBeVisible();
    await editor.editor.save();

    await expect(editor.editor.unsavedBadge).toBeHidden();
    const saved = await api.getTopology(topology.id);
    expect(saved.bindFiles[0].content).toBe('hostname router1');
  });

  test('a file can be renamed', async ({page, api, createTopology}) => {
    const topology = await createTopology({files: {'startup.cfg': 'content'}});
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);

    await editor.explorer.rowAction('startup.cfg', 'Edit File');
    const dialog = new Dialog(page, 'Rename File');
    await dialog.fill('File Path', 'boot.cfg');
    await dialog.button('Apply').click();

    await expect(
      toast(page, 'File has been edited successfully.'),
    ).toBeVisible();
    await expect(editor.explorer.row('boot.cfg')).toBeVisible();
    expect(await filePaths(api, topology.id)).toEqual(['boot.cfg']);
  });

  test('a file can be deleted', async ({page, api, createTopology}) => {
    const topology = await createTopology({
      files: {
        'startup.cfg': '',
        'other.cfg': '',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);

    await editor.explorer.rowAction('startup.cfg', 'Delete File');
    const confirm = new ConfirmDialog(page);
    await expect(confirm.root).toContainText('Delete File "startup.cfg"?');
    await confirm.accept();

    await expect(toast(page, 'File has been deleted.')).toBeVisible();
    await expect(editor.explorer.row('startup.cfg')).toBeHidden();
    expect(await filePaths(api, topology.id)).toEqual(['other.cfg']);
  });

  test('a directory can be renamed', async ({page, api, createTopology}) => {
    const topology = await createTopology({
      files: {
        'node1/startup.cfg': '',
        'node1/interfaces': '',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);

    await editor.explorer.rowAction('node1', 'Edit Directory');
    const dialog = new Dialog(page, 'Rename Directory');
    await dialog.fill('Directory Name', 'router1');
    await dialog.button('Apply').click();

    await expect(dialog.root).toBeHidden();
    await expect(editor.explorer.row('router1')).toBeVisible();
    expect(await filePaths(api, topology.id)).toEqual([
      'router1/interfaces',
      'router1/startup.cfg',
    ]);
  });

  test('a directory can be deleted with its files', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({
      files: {
        'node1/startup.cfg': '',
        'node1/interfaces': '',
        'other.cfg': '',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);

    await editor.explorer.rowAction('node1', 'Delete Directory');
    const confirm = new ConfirmDialog(page);
    await expect(confirm.root).toContainText('Delete directory "./node1"?');
    await expect(confirm.root).toContainText('node1/startup.cfg');
    await confirm.accept();

    await expect(editor.explorer.row('node1')).toBeHidden();
    expect(await filePaths(api, topology.id)).toEqual(['other.cfg']);
  });

  test('renaming a directory leaves directories with a similar name alone', async ({
    page,
    api,
    createTopology,
  }) => {
    test.fail(
      true,
      'Known bug: directory operations match files by path prefix, so node1 also matches node10/',
    );
    const topology = await createTopology({
      files: {
        'node1/startup.cfg': '',
        'node10/startup.cfg': '',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);

    await editor.explorer.rowAction('node1', 'Edit Directory');
    const dialog = new Dialog(page, 'Rename Directory');
    await dialog.fill('Directory Name', 'router1');
    await dialog.button('Apply').click();
    await expect(dialog.root).toBeHidden();

    expect(await filePaths(api, topology.id)).toEqual([
      'node10/startup.cfg',
      'router1/startup.cfg',
    ]);
  });

  test('deleting a directory leaves directories with a similar name alone', async ({
    page,
    api,
    createTopology,
  }) => {
    test.fail(
      true,
      'Known bug: directory operations match files by path prefix, so node1 also matches node10/',
    );
    const topology = await createTopology({
      files: {
        'node1/startup.cfg': '',
        'node10/startup.cfg': '',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);

    await editor.explorer.rowAction('node1', 'Delete Directory');
    await new ConfirmDialog(page).accept();
    await expect(editor.explorer.row('node1')).toBeHidden();

    expect(await filePaths(api, topology.id)).toEqual(['node10/startup.cfg']);
  });

  test('a bind file can be downloaded', async ({page, createTopology}) => {
    test.fail(
      true,
      'Known bug: the download looks up the topology by the bind file ID and silently does nothing',
    );
    const topology = await createTopology({files: {'startup.cfg': 'content'}});
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name, topology.name);
    await editor.explorer.open('startup.cfg');
    await expect.poll(() => editorText(editor.editor.monaco)).toBe('content');

    const downloadPromise = page.waitForEvent('download', {timeout: 5_000});
    await editor.editor.button('Download').click();

    expect((await downloadPromise).suggestedFilename()).toBe('startup.cfg');
  });

  test('a missing file referenced in binds can be created from the link', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const name = uniqueName('topology');
    const topologyId = await api.createTopology(
      collection.id,
      `name: ${name}\ntopology:\n  nodes:\n    host1:\n      kind: linux\n` +
        '      image: alpine:latest\n      binds:\n        - missing.cfg:/etc/missing.cfg\n',
    );
    const editor = new EditorPage(page);
    await editor.goto(topologyId);
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('missing.cfg');

    // Monaco opens links with Ctrl/Cmd + click
    await editor.editor.monaco
      .locator('.view-line span', {hasText: 'missing.cfg'})
      .first()
      .click({modifiers: ['ControlOrMeta']});

    const confirm = new ConfirmDialog(page);
    await expect(confirm.root).toContainText('File does not exist');
    await confirm.accept();

    await expect(
      toast(page, 'Bind file has been created successfully.'),
    ).toBeVisible();
    expect(await filePaths(api, topologyId)).toEqual(['missing.cfg']);
  });
});
