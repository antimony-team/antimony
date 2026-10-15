import {expect, test} from '../fixtures/test';
import {createZip} from '../helpers/zip';
import {Dialog} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/** An archive file for the upload input, built from path → content. */
function archive(name: string, files: Record<string, string>) {
  return {name, mimeType: 'application/zip', buffer: createZip(files)};
}

/*
 * Every test uses its own file names. Existing files are looked up by path across all topologies
 * (see the known bug below), so a shared name would make the tests depend on each other.
 */

test.describe('archive upload', () => {
  test('the files of an archive are added to a topology', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);

    // The upload button opens a hidden file input in the topology's row
    await editor.explorer
      .row(topology.name)
      .locator('input[type="file"]')
      .setInputFiles(
        archive('bind-files.zip', {
          'startup.cfg': 'hostname router1\n',
          'node1/interfaces': 'eth1\n',
        }),
      );

    const dialog = new Dialog(page, 'Upload Bind Files');
    await expect(dialog.root).toContainText('bind-files.zip');
    await expect(dialog.root).toContainText('startup.cfg');
    await expect(dialog.root).toContainText('interfaces');
    await dialog.button('Upload').click();

    await expect
      .poll(async () => {
        const files = (await api.getTopology(topology.id)).bindFiles;
        return files.map(file => [file.filePath, file.content]).sort();
      })
      .toEqual([
        ['node1/interfaces', 'eth1\n'],
        ['startup.cfg', 'hostname router1\n'],
      ]);

    // The dialog doesn't close by itself (see the known bug below)
    await page.keyboard.press('Escape');
    await editor.explorer.expand(topology.name, 'node1');
    await expect(editor.explorer.row('startup.cfg')).toBeVisible();
    await expect(editor.explorer.row('interfaces')).toBeVisible();
  });

  test('the dialog closes after uploading', async ({page, createTopology}) => {
    test.fail(
      true,
      'Known bug: the upload dialog never closes itself after the upload',
    );

    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer
      .row(topology.name)
      .locator('input[type="file"]')
      .setInputFiles(
        archive('bind-files.zip', {
          'startup.cfg': 'hostname router1\n',
          'node1/interfaces': 'eth1\n',
        }),
      );

    const dialog = new Dialog(page, 'Upload Bind Files');
    await dialog.button('Upload').click();

    await expect(dialog.root).toBeHidden({timeout: 3_000});
  });

  test('existing files are marked and overwritten', async ({
    page,
    api,
    createTopology,
    uniqueName,
  }) => {
    const file = `${uniqueName('file')}.cfg`;
    const topology = await createTopology({files: {[file]: 'old'}});
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer
      .row(topology.name)
      .locator('input[type="file"]')
      .setInputFiles(archive('overwrite.zip', {[file]: 'new content\n'}));

    const dialog = new Dialog(page, 'Upload Bind Files');
    await expect(dialog.root).toContainText('File exists');
    await dialog.button('Upload').click();

    await expect
      .poll(async () => (await api.getTopology(topology.id)).bindFiles)
      .toEqual([
        expect.objectContaining({
          filePath: file,
          content: 'new content\n',
        }),
      ]);
  });

  test("overwriting a file leaves other topologies' files alone", async ({
    page,
    api,
    createTopology,
    uniqueName,
  }) => {
    test.fail(
      true,
      'Known bug: the upload looks up existing files by path across all topologies, so it ' +
        "overwrites another topology's file instead of this one's",
    );

    // An earlier topology with a file at the same path
    const file = `${uniqueName('file')}.cfg`;
    const other = await createTopology({files: {[file]: 'other'}});
    const topology = await createTopology({
      collection: other.collection,
      files: {[file]: 'old'},
    });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);
    await editor.explorer
      .row(topology.name)
      .locator('input[type="file"]')
      .setInputFiles(archive('overwrite.zip', {[file]: 'new content\n'}));

    const dialog = new Dialog(page, 'Upload Bind Files');
    await expect(dialog.root).toContainText('File exists');
    await dialog.button('Upload').click();

    await expect
      .poll(async () => (await api.getTopology(topology.id)).bindFiles[0])
      .toMatchObject({content: 'new content\n'});
    expect((await api.getTopology(other.id)).bindFiles[0].content).toBe(
      'other',
    );
  });
});
