import {expect, knownBug, test} from '../fixtures/test';
import {createZip} from '../helpers/zip';
import {ConfirmDialog, Dialog, toast} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/*
 * Bind files: files that belong to a topology, such as startup configs. They're listed under their
 * topology in the explorer, with a directory for every folder in their path.
 */

function bindFile(
  api: {
    getTopology: (id: string) => Promise<{
      bindFiles: {filePath: string; content: string; id: string}[];
    }>;
  },
  topologyId: string,
  path: string,
) {
  return api
    .getTopology(topologyId)
    .then(t => t.bindFiles.find(f => f.filePath === path));
}

test('a file can be added to a topology', async ({
  page,
  api,
  createTopology,
}) => {
  const topology = await createTopology();
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  await editor.explorer.menu(topology.name, 'New file');
  const dialog = editor.explorer.fileDialog('Add file');
  await dialog.fill('File path', 'startup.cfg');
  await dialog.submit('Apply');

  await expect(
    toast(page, 'File has been created successfully.'),
  ).toBeVisible();
  await editor.explorer.expand(topology.name);
  await expect(editor.explorer.row('startup.cfg')).toBeVisible();
  expect(await bindFile(api, topology.id, 'startup.cfg')).toBeDefined();
});

test('a nested path creates directories in the tree', async ({
  page,
  createTopology,
}) => {
  const topology = await createTopology({
    files: {'node1/config/startup.cfg': 'hostname node1'},
  });
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);
  await editor.explorer.expand(topology.name);

  await editor.explorer.expand('node1');
  await editor.explorer.expand('config');
  await expect(editor.explorer.row('startup.cfg')).toBeVisible();
});

test('a file path must be valid and unique', async ({page, createTopology}) => {
  const topology = await createTopology({files: {'startup.cfg': ''}});
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);

  await editor.explorer.menu(topology.name, 'New file');
  const dialog = editor.explorer.fileDialog('Add file');
  await dialog.fill('File path', 'startup.cfg');
  await dialog.submit('Apply');
  await expect(dialog.validationError()).toContainText(
    'A file with that path already exists',
  );

  // Paths may not leave the topology's folder
  await dialog.fill('File path', '../escape.cfg');
  await dialog.submit('Apply');
  await expect(dialog.root).toBeVisible();
  await expect(page.locator('.p-toast-message-error')).toBeVisible();
});

test('a file can be edited and saved', async ({page, api, createTopology}) => {
  const topology = await createTopology({files: {'startup.cfg': 'old'}});
  const file = await bindFile(api, topology.id, 'startup.cfg');
  const editor = new EditorPage(page);
  await editor.open(file!.id, 'startup.cfg');

  // Bind files have no graph
  await expect(editor.editor.view('Graph')).toBeDisabled();
  await expect(editor.editor.view('Split')).toBeDisabled();

  await editor.editor.setText('hostname router1');
  await expect(editor.editor.save).toBeEnabled();
  await editor.editor.save.click();

  await expect(editor.editor.save).toBeDisabled();
  await expect
    .poll(
      async () => (await bindFile(api, topology.id, 'startup.cfg'))?.content,
    )
    .toBe('hostname router1');
});

test('an edited file is marked as unsaved', async ({
  page,
  api,
  createTopology,
}) => {
  knownBug(
    'bind files with unsaved edits get no "*" in the title, unlike topologies',
  );
  const topology = await createTopology({files: {'startup.cfg': 'old'}});
  const file = await bindFile(api, topology.id, 'startup.cfg');
  const editor = new EditorPage(page);
  await editor.open(file!.id, 'startup.cfg');

  await editor.editor.setText('new');

  await expect(editor.editor.title).toHaveText(/startup\.cfg\*$/);
});

test('a file can be renamed', async ({page, api, createTopology}) => {
  const topology = await createTopology({files: {'startup.cfg': 'x'}});
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);
  await editor.explorer.expand(topology.name);

  await editor.explorer.menu('startup.cfg', 'Edit');
  const dialog = editor.explorer.fileDialog('Edit file');
  await expect(dialog.field('File path')).toHaveValue('startup.cfg');
  await dialog.fill('File path', 'router1/startup.cfg');
  await dialog.submit('Apply');

  await expect(toast(page, 'File has been edited successfully.')).toBeVisible();
  expect(await bindFile(api, topology.id, 'router1/startup.cfg')).toBeDefined();
  expect(await bindFile(api, topology.id, 'startup.cfg')).toBeUndefined();
});

test('deleting a file needs its path typed in', async ({
  page,
  api,
  createTopology,
}) => {
  const topology = await createTopology({files: {'startup.cfg': 'x'}});
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.explorer.expand(topology.collection.name);
  await editor.explorer.expand(topology.name);

  await editor.explorer.menu('startup.cfg', 'Delete');
  const confirm = new ConfirmDialog(page);
  await expect(confirm.root).toContainText(
    'Are you sure you want to delete the file "startup.cfg"?',
  );

  await confirm.typeConfirmation('wrong');
  await confirm.accept('Delete file');
  await expect(confirm.root).toContainText('Confirmation code does not match');
  expect(await bindFile(api, topology.id, 'startup.cfg')).toBeDefined();

  await confirm.typeConfirmation('startup.cfg');
  await confirm.accept('Delete file');
  await expect(toast(page, 'File has been deleted.')).toBeVisible();
  expect(await bindFile(api, topology.id, 'startup.cfg')).toBeUndefined();
});

test.describe('directories', () => {
  test('a directory can be renamed with its files', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({
      files: {'node1/a.cfg': 'a', 'node1/b.cfg': 'b'},
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer.expand(topology.name);

    await editor.explorer.menu('node1', 'Edit');
    const dialog = editor.explorer.fileDialog('Edit directory');
    await dialog.fill('Name', 'router1');
    await dialog.submit('Apply');

    await expect
      .poll(async () =>
        (await api.getTopology(topology.id)).bindFiles
          .map(f => f.filePath)
          .sort(),
      )
      .toEqual(['router1/a.cfg', 'router1/b.cfg']);
  });

  test('a directory can be deleted with its files', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({
      files: {'node1/a.cfg': 'a', 'node1/b.cfg': 'b', 'other.cfg': 'c'},
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer.expand(topology.name);

    await editor.explorer.menu('node1', 'Delete');
    const confirm = new ConfirmDialog(page);
    await expect(confirm.header).toHaveText('Delete directory "./node1"?');
    await confirm.accept();

    await expect
      .poll(async () =>
        (await api.getTopology(topology.id)).bindFiles.map(f => f.filePath),
      )
      .toEqual(['other.cfg']);
  });

  test('renaming a directory leaves files with a similar name alone', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({
      files: {
        'node1/startup.cfg': 'a',
        'node10/startup.cfg': 'b',
        'node1.cfg': 'c',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer.expand(topology.name);

    await editor.explorer.menu('node1', 'Edit');
    const dialog = editor.explorer.fileDialog('Edit directory');
    await dialog.fill('Name', 'router1');
    await dialog.submit('Apply');

    // The files are renamed one by one; wait until the directory is renamed, then a moment for any
    // further rename to arrive
    await expect
      .poll(async () =>
        (await api.getTopology(topology.id)).bindFiles.some(f =>
          f.filePath.startsWith('router1/'),
        ),
      )
      .toBe(true);
    await page.waitForTimeout(2000);
    expect(
      (await api.getTopology(topology.id)).bindFiles
        .map(f => f.filePath)
        .sort(),
    ).toEqual(['node1.cfg', 'node10/startup.cfg', 'router1/startup.cfg']);
  });

  test('deleting a directory leaves files with a similar name alone', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({
      files: {
        'node1/startup.cfg': 'a',
        'node10/startup.cfg': 'b',
        'node1.cfg': 'c',
      },
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer.expand(topology.name);

    await editor.explorer.menu('node1', 'Delete');
    await new ConfirmDialog(page).accept();

    // The files are deleted one by one; wait until the directory itself is gone, then a moment for any
    // further deletion to arrive
    await expect
      .poll(async () =>
        (await api.getTopology(topology.id)).bindFiles.some(f =>
          f.filePath.startsWith('node1/'),
        ),
      )
      .toBe(false);
    await page.waitForTimeout(2000);
    expect(
      (await api.getTopology(topology.id)).bindFiles
        .map(f => f.filePath)
        .sort(),
    ).toEqual(['node1.cfg', 'node10/startup.cfg']);
  });

  test('a directory with a dash in its name opens on click', async ({
    page,
    createTopology,
  }) => {
    knownBug(
      'directories are recognised by the number of dashes in their key, so names with a dash are treated as files',
    );
    const topology = await createTopology({files: {'core-1/startup.cfg': 'a'}});
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer.expand(topology.name);

    await editor.explorer.row('core-1').locator('.tree-node').click();

    await expect(editor.explorer.row('startup.cfg')).toBeVisible();
  });
});

test.describe('archive upload', () => {
  async function upload(
    page: import('@playwright/test').Page,
    editor: EditorPage,
    topologyName: string,
    files: Record<string, string>,
  ) {
    const chooser = page.waitForEvent('filechooser');
    await editor.explorer.menu(topologyName, 'Upload files');
    await (
      await chooser
    ).setFiles({
      name: 'files.zip',
      mimeType: 'application/zip',
      buffer: createZip(files),
    });
    return new Dialog(page, 'Upload Bind Files');
  }

  test('the files of an archive are added to a topology', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);

    const dialog = await upload(page, editor, topology.name, {
      'node1/startup.cfg': 'hostname node1',
      'node2/startup.cfg': 'hostname node2',
    });
    // The dialog lists the files in a tree, under their directories
    const rows = dialog.root.locator('.sb-archive-upload-dialog-file');
    await expect(rows.filter({hasText: 'node1'})).not.toHaveCount(0);
    await expect(rows.filter({hasText: 'node2'})).not.toHaveCount(0);
    await dialog.submit('Upload');

    await expect(dialog.root).toBeHidden();
    await expect
      .poll(async () =>
        (await api.getTopology(topology.id)).bindFiles
          .map(f => `${f.filePath}=${f.content}`)
          .sort(),
      )
      .toEqual([
        'node1/startup.cfg=hostname node1',
        'node2/startup.cfg=hostname node2',
      ]);
  });

  test('existing files are marked and overwritten', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({files: {'startup.cfg': 'old'}});
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);

    const dialog = await upload(page, editor, topology.name, {
      'startup.cfg': 'new',
    });
    await expect(dialog.root).toContainText('File exists');
    await dialog.submit('Upload');

    await expect
      .poll(
        async () => (await bindFile(api, topology.id, 'startup.cfg'))?.content,
      )
      .toBe('new');
  });

  test("overwriting a file leaves other topologies' files alone", async ({
    page,
    api,
    createTopology,
  }) => {
    const other = await createTopology({files: {'startup.cfg': 'other'}});
    const target = await createTopology({
      collection: other.collection,
      files: {'startup.cfg': 'old'},
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(target.collection.name);

    const dialog = await upload(page, editor, target.name, {
      'startup.cfg': 'new',
    });
    await dialog.submit('Upload');

    await expect
      .poll(
        async () => (await bindFile(api, target.id, 'startup.cfg'))?.content,
      )
      .toBe('new');
    expect((await bindFile(api, other.id, 'startup.cfg'))?.content).toBe(
      'other',
    );
  });
});

test('a missing file in binds can be created from its link', async ({
  page,
  api,
  createTopology,
}) => {
  const topology = await createTopology({
    definition: name =>
      `name: ${name}\ntopology:\n  nodes:\n    host1:\n      kind: linux\n      image: alpine:latest\n      binds:\n        - host1/motd:/etc/motd\n`,
    annotations: '{}',
  });
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);
  await editor.editor.view('Code').click();

  await editor.editor.monaco
    .locator('.view-line')
    .getByText('host1/motd')
    .click({modifiers: ['ControlOrMeta']});
  const confirm = new ConfirmDialog(page);
  await expect(confirm.root).toContainText('Do you want to create this file?');
  await confirm.accept(/Ok|Create|Yes/);

  await expect(
    toast(page, 'Bind file has been created successfully.'),
  ).toBeVisible();
  expect(await bindFile(api, topology.id, 'host1/motd')).toBeDefined();
});
