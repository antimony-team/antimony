import {ApiError, topologyDefinition} from '../fixtures/api';
import {expect, knownBug, test} from '../fixtures/test';
import {clickGraphNode} from '../helpers/cytoscape';
import {DashboardPage} from '../pages/dashboard-page';
import {menuItem, toast} from '../pages/dialogs';
import {Dock} from '../pages/dock';
import {EditorPage} from '../pages/editor-page';
import {LabEditDialog} from '../pages/lab-edit-dialog';
import {LabView} from '../pages/lab-view';

/*
 * What users who aren't admins may do. A user is a member of the collections named in their groups.
 * Collections decide the rest:
 *
 * - "Anyone can edit" (publicWrite): members may add topologies, and edit the ones they created
 * - "Anyone can deploy" (publicDeploy): members may create labs from its topologies
 *
 * Deploying, destroying and node commands of a lab, and editing or deleting a topology, are only for
 * its creator and the admins. The server enforces all of this; the interface should only offer what is
 * allowed. The first part checks the server, the second what the interface shows.
 */

/** Runs an API call and returns the HTTP status it failed with, or 200. */
async function status(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

test.describe('server rules', () => {
  test('users only see the collections, topologies and labs they are members of', async ({
    createCollection,
    createLab,
    createUser,
  }) => {
    const mine = await createCollection();
    const theirs = await createCollection();
    const myLab = await createLab({collection: mine});
    const theirLab = await createLab({collection: theirs});
    const user = await createUser({collections: [mine]});

    expect((await user.api.getCollections()).map(c => c.id)).toEqual([mine.id]);
    const topologies = (await user.api.getTopologies()).map(t => t.id);
    expect(topologies).toContain(myLab.topology.id);
    expect(topologies).not.toContain(theirLab.topology.id);
    expect((await user.api.getLabs()).map(l => l.id)).toEqual([myLab.id]);

    expect(await status(user.api.getTopology(theirLab.topology.id))).toBe(403);
    expect(await status(user.api.getLab(theirLab.id))).toBe(403);
  });

  test('only admins create, change and delete collections', async ({
    createCollection,
    createUser,
    uniqueName,
  }) => {
    const collection = await createCollection({publicWrite: true});
    const user = await createUser({collections: [collection]});

    expect(await status(user.api.createCollection(uniqueName('c')))).toBe(403);
    expect(
      await status(user.api.updateCollection(collection.id, {name: 'x'})),
    ).toBe(403);
    expect(await status(user.api.deleteCollection(collection.id))).toBe(403);
  });

  test('members add topologies only to collections anyone can edit', async ({
    createCollection,
    createUser,
    uniqueName,
  }) => {
    const writable = await createCollection({publicWrite: true});
    const readOnly = await createCollection({publicDeploy: true});
    const outside = await createCollection({publicWrite: true});
    const user = await createUser({collections: [writable, readOnly]});
    const create = (collectionId: string) =>
      user.api.createTopology(
        collectionId,
        topologyDefinition(uniqueName('t'), ['a']),
      );

    expect(await status(create(writable.id))).toBe(200);
    expect(await status(create(readOnly.id))).toBe(403);
    // Not a member: publicWrite alone isn't enough
    expect(await status(create(outside.id))).toBe(403);
  });

  test('only the creator edits a topology', async ({
    createCollection,
    createTopology,
    createUser,
  }) => {
    const collection = await createCollection({publicWrite: true});
    const creator = await createUser({collections: [collection]});
    const other = await createUser({collections: [collection]});
    const topology = await createTopology({collection, by: creator});
    const edit = (user: typeof creator) =>
      user.api.updateTopology(topology.id, {
        definition: topologyDefinition(topology.name, ['edited']),
      });

    expect(await status(edit(other))).toBe(403);
    expect(await status(other.api.deleteTopology(topology.id))).toBe(403);
    expect(
      await status(other.api.createBindFile(topology.id, 'x.cfg', '')),
    ).toBe(403);
    expect(await status(edit(creator))).toBe(200);
  });

  test('a creator can no longer edit once the collection is read-only', async ({
    api,
    createCollection,
    createTopology,
    createUser,
  }) => {
    const collection = await createCollection({publicWrite: true});
    const creator = await createUser({collections: [collection]});
    const topology = await createTopology({collection, by: creator});

    await api.updateCollection(collection.id, {publicWrite: false});

    expect(
      await status(
        creator.api.updateTopology(topology.id, {
          definition: topologyDefinition(topology.name, ['edited']),
        }),
      ),
    ).toBe(403);
  });

  test('a creator can not change bind files once the collection is read-only', async ({
    api,
    createCollection,
    createTopology,
    createUser,
  }) => {
    knownBug(
      "bind files and deleting a topology only check the creator, not the collection's publicWrite",
    );
    const collection = await createCollection({publicWrite: true});
    const creator = await createUser({collections: [collection]});
    const topology = await createTopology({collection, by: creator});

    await api.updateCollection(collection.id, {publicWrite: false});

    expect(
      await status(creator.api.createBindFile(topology.id, 'x.cfg', '')),
    ).toBe(403);
  });

  test('members create labs only in collections anyone can deploy', async ({
    createCollection,
    createTopology,
    createUser,
    uniqueName,
  }) => {
    const deployable = await createCollection({publicDeploy: true});
    const editable = await createCollection({publicWrite: true});
    const a = await createTopology({collection: deployable});
    const b = await createTopology({collection: editable});
    const user = await createUser({collections: [deployable, editable]});

    expect(await status(user.api.createLab(a.id, uniqueName('lab')))).toBe(200);
    expect(await status(user.api.createLab(b.id, uniqueName('lab')))).toBe(403);
  });

  test('only the creator deploys, destroys and controls a lab', async ({
    api,
    createCollection,
    createLab,
    createUser,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const creator = await createUser({collections: [collection]});
    const other = await createUser({collections: [collection]});
    const lab = await createLab({collection, by: creator});

    expect((await other.api.command(0, lab.id)).code).toBe(5403);
    expect(await status(other.api.updateLab(lab.id, {name: 'x'}))).toBe(403);
    expect(await status(other.api.deleteLab(lab.id))).toBe(403);

    await creator.api.deployLab(lab.id);
    expect((await other.api.command(3, lab.id, {node: 'host1'})).code).toBe(
      5403,
    );
    expect((await other.api.command(1, lab.id)).code).toBe(5403);

    // Admins may do everything
    await api.destroyLab(lab.id);
  });

  test("members may open terminals on other members' labs", async ({
    createCollection,
    createLab,
    createUser,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const creator = await createUser({collections: [collection]});
    const member = await createUser({collections: [collection]});
    const outsider = await createUser();
    const lab = await createLab({collection, by: creator, deployed: true});

    const open = (user: typeof member) =>
      user.api.command(6, lab.id, {node: 'host1', cols: 80, rows: 24});
    expect((await open(member)).payload).toBeTruthy();
    expect((await open(outsider)).code).toBe(5403);
  });
});

test.describe('interface', () => {
  test('a member of a read-only collection sees its topologies read-only', async ({
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const collection = await createCollection();
    const topology = await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const editor = new EditorPage(user.page);

    await editor.open(topology.id, topology.name);

    await expect(editor.editor.readOnlyBanner).toContainText(
      'The current file is opened in read-only mode.',
    );
    // Nothing to add, edit or delete in the explorer
    await editor.explorer.row(collection.name).click({button: 'right'});
    await expect(
      user.page.locator('.p-contextmenu').filter({visible: true}),
    ).toHaveCount(0);
    await editor.explorer.expand(collection.name);
    await editor.explorer.row(topology.name).click({button: 'right'});
    await expect(menuItem(user.page, 'Delete')).toHaveCount(0);
    await expect(menuItem(user.page, 'Edit')).toHaveCount(0);
  });

  test('the graph of a read-only topology can not be edited', async ({
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const collection = await createCollection();
    const topology = await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const editor = new EditorPage(user.page);
    await editor.open(topology.id, topology.name);
    await editor.editor.view('Graph').click();
    await editor.graph.waitForNodes(2);

    // The notice is shown over the graph too, and only the viewing tools are left
    await expect(user.page.locator('.sb-node-editor-readonly')).toContainText(
      'read-only',
    );
    await expect(editor.graph.tool('Select')).toBeVisible();
    await expect(editor.graph.tool('Fit graph')).toBeVisible();
    await expect(editor.graph.tool('Rectangle')).toBeHidden();
    await expect(editor.graph.tool('Add node')).toBeHidden();
    await expect(editor.graph.tool('Clear graph')).toBeHidden();

    // Keyboard shortcuts don't change it either
    await editor.graph.clickNode('host1');
    await user.page.keyboard.press('Delete');
    await editor.graph.waitForNodes(2);
    await expect(editor.editor.save).toBeDisabled();
  });

  test('a creator can not edit once the collection is read-only', async ({
    api,
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const collection = await createCollection({publicWrite: true});
    const user = await loginAs({collections: [collection]});
    const topology = await createTopology({collection, by: user});
    await api.updateCollection(collection.id, {publicWrite: false});
    const editor = new EditorPage(user.page);

    await editor.open(topology.id, topology.name);

    await expect(editor.editor.readOnlyBanner).toBeVisible();
  });

  test('without "Anyone can deploy" members get no Deploy buttons', async ({
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const collection = await createCollection({publicWrite: true});
    const topology = await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const editor = new EditorPage(user.page);
    await editor.open(topology.id, topology.name);

    await expect(editor.editor.deploy).toBeHidden();
    await editor.explorer.expand(collection.name);
    await editor.explorer.row(topology.name).hover();
    await expect(
      editor.explorer.rowButton(topology.name, 'Deploy topology'),
    ).toBeHidden();
    await editor.explorer.row(topology.name).click({button: 'right'});
    await expect(menuItem(user.page, 'Deploy')).toHaveCount(0);
  });

  test('with "Anyone can deploy" members get the Deploy buttons', async ({
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const topology = await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const editor = new EditorPage(user.page);

    await editor.open(topology.id, topology.name);

    await expect(editor.editor.deploy).toBeVisible();
  });

  test('a member can add a topology to a collection anyone can edit', async ({
    api,
    createCollection,
    createTopology,
    loginAs,
    uniqueName,
  }) => {
    const collection = await createCollection({publicWrite: true});
    await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const name = uniqueName('topology');
    const editor = new EditorPage(user.page);
    await editor.goto();

    await editor.explorer.menu(collection.name, 'New topology');
    const dialog = editor.explorer.topologyDialog('Add topology');
    await editor.explorer.waitForDialogCollection(dialog, collection.name);
    await dialog.fill('Name', name);
    await dialog.submit('Apply');

    await editor.explorer.expand(collection.name);
    await expect(editor.explorer.row(name)).toBeVisible();
    const created = (await api.getTopologies()).find(t =>
      t.definition.includes(`name: ${name}`),
    );
    expect(created?.creator.name).toBe(user.username);
    // The creator may edit it
    await editor.explorer.open(name);
    await expect(editor.editor.readOnlyBanner).toBeHidden();
    await api.deleteTopology(created!.id);
  });

  test('a collection anyone can edit has the Add topology button for members', async ({
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const collection = await createCollection({publicWrite: true});
    await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const editor = new EditorPage(user.page);
    await editor.goto();

    await editor.explorer.row(collection.name).hover();
    await expect(
      editor.explorer.rowButton(collection.name, 'Add topology'),
    ).toBeVisible();
  });

  test('a read-only collection has no Add topology button for members', async ({
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const editor = new EditorPage(user.page);
    await editor.goto();

    await editor.explorer.row(collection.name).hover();
    await expect(
      editor.explorer.rowButton(collection.name, 'Add topology'),
    ).toBeHidden();
  });

  test('a member deploys a lab in a collection anyone can deploy', async ({
    api,
    createCollection,
    createTopology,
    loginAs,
    uniqueName,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const topology = await createTopology({collection});
    const user = await loginAs({collections: [collection]});
    const name = uniqueName('lab');
    const dashboard = new DashboardPage(user.page);
    await dashboard.goto();

    await dashboard.newLab.click();
    const dialog = new LabEditDialog(user.page);
    await dialog.setName(name);
    await dialog.selectTopology(topology.name);
    await dialog.submit('Deploy');

    await expect(
      toast(user.page, 'Lab has been created successfully.'),
    ).toBeVisible();
    await expect(dashboard.cardState(name)).toHaveText('Running');
    const lab = await api.findLab(name);
    expect(lab?.creator.name).toBe(user.username);
    await api.destroyLab(lab!.id);
    await api.deleteLab(lab!.id);
  });

  test('users who may not deploy anywhere get no New lab button', async ({
    createCollection,
    createLab,
    loginAs,
  }) => {
    const collection = await createCollection({publicWrite: true});
    await createLab({collection});
    const user = await loginAs({collections: [collection]});
    const dashboard = new DashboardPage(user.page);

    await dashboard.goto();
    await expect(dashboard.explorerItem(collection.name)).toBeVisible();

    await expect(dashboard.newLab).toBeHidden();
  });

  test('the deploy dialog only offers topologies the user may deploy', async ({
    createCollection,
    createTopology,
    loginAs,
  }) => {
    const deployable = await createCollection({publicDeploy: true});
    const readOnly = await createCollection();
    const offered = await createTopology({collection: deployable});
    const hidden = await createTopology({collection: readOnly});
    const user = await loginAs({collections: [deployable, readOnly]});
    await new DashboardPage(user.page).goto();

    await new DashboardPage(user.page).newLab.click();
    const dialog = new LabEditDialog(user.page);
    await dialog.root.locator('.p-dropdown:has(#edit-lab-topology)').click();

    const options = user.page.locator('.p-dropdown-panel').getByRole('option');
    await expect(options.filter({hasText: offered.name})).toHaveCount(1);
    await expect(options.filter({hasText: hidden.name})).toHaveCount(0);
  });

  test('only admins get the lab schedule', async ({
    page,
    createCollection,
    loginAs,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const user = await loginAs({collections: [collection]});

    await user.page.goto('/');
    await expect(new Dock(user.page).logout).toBeVisible();
    await expect(new Dock(user.page).schedule).toBeHidden();

    await page.goto('/');
    await expect(new Dock(page).schedule).toBeVisible();
  });

  test("a member's own lab can be deployed and destroyed by them", async ({
    createCollection,
    createLab,
    loginAs,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const user = await loginAs({collections: [collection]});
    const lab = await createLab({collection, by: user});
    const labView = new LabView(user.page);
    await labView.open(lab.id);

    await labView.deploy();
    await expect(labView.state).toHaveText('running');
    await labView.destroy();
    await expect(labView.deployButton).toBeVisible();
  });

  test("another member's lab offers no deploy, destroy or node controls", async ({
    createCollection,
    createLab,
    createUser,
    loginAs,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const creator = await createUser({collections: [collection]});
    const lab = await createLab({collection, by: creator, deployed: true});
    const member = await loginAs({collections: [collection]});
    const labView = new LabView(member.page);

    await labView.open(lab.id);
    await expect(labView.state).toHaveText('running');

    await expect(labView.deployButton).toBeHidden();
    await expect(labView.redeployButton).toBeHidden();
    await expect(labView.destroyButton).toBeHidden();
    // Logs and terminals stay available to members
    await expect(labView.logsButton).toBeEnabled();

    await clickGraphNode(labView.graph, 'host1', {button: 'right'});
    await expect(menuItem(member.page, 'Open terminal')).toBeVisible();
    await expect(menuItem(member.page, 'Stop node')).toHaveCount(0);
    await member.page.keyboard.press('Escape');

    await labView.clickNode('host1');
    await expect(labView.drawer.button('Open terminal')).toBeVisible();
    await expect(labView.drawer.button('Shutdown')).toBeHidden();
    await expect(labView.drawer.button('Restart')).toBeHidden();
  });

  test('users only see the labs of their collections on the dashboard', async ({
    createCollection,
    createLab,
    loginAs,
  }) => {
    const mine = await createCollection();
    const theirs = await createCollection();
    const myLab = await createLab({collection: mine});
    const theirLab = await createLab({collection: theirs});
    const user = await loginAs({collections: [mine]});
    const dashboard = new DashboardPage(user.page);

    await dashboard.goto();

    await expect(dashboard.card(myLab.name)).toBeVisible();
    await expect(dashboard.card(theirLab.name)).toBeHidden();
    await expect(dashboard.explorerItem(theirs.name)).toBeHidden();
    // Members of a collection may use the editor
    await expect(new Dock(user.page).editor).toBeVisible();
  });
});
