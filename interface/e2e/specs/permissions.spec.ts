import {expect, test} from '../fixtures/test';
import {editorText, setEditorText} from '../helpers/monaco';
import {Dialog, toast} from '../pages/dialogs';
import {DashboardPage} from '../pages/dashboard-page';
import {EditorPage} from '../pages/editor-page';

/*
 * Students are non-admin users created per test (see createStudent in fixtures/test.ts). They only
 * see collections they are a member of. In those, publicWrite lets them create and edit their own
 * topologies, and publicDeploy lets them deploy labs.
 */
test.describe('permissions', () => {
  test('a student without collections has no access to the editor', async ({
    createStudent,
  }) => {
    const student = await createStudent();
    const editor = new EditorPage(student.page);

    await editor.goto();

    await expect(student.page.getByText('403')).toBeVisible();
    await expect(
      student.page.getByText('You do not have access to this page'),
    ).toBeVisible();
  });

  test('a student only sees labs of their collections', async ({
    createLab,
    createStudent,
  }) => {
    const visible = await createLab();
    const hidden = await createLab();
    const student = await createStudent([visible.topology.collection.name]);
    const dashboard = new DashboardPage(student.page);
    await dashboard.goto();

    await dashboard.searchFor(visible.name);
    await expect(dashboard.labCard(visible.id)).toBeVisible();
    await dashboard.searchFor(hidden.name);
    await expect(dashboard.labCard(hidden.id)).toBeHidden();
  });

  test('a student only sees collections they are a member of', async ({
    createCollection,
    createStudent,
  }) => {
    const member = await createCollection();
    // Even fully public collections stay invisible to non-members
    const other = await createCollection({
      publicWrite: true,
      publicDeploy: true,
    });
    const student = await createStudent([member.name]);
    const editor = new EditorPage(student.page);

    await editor.goto();

    await expect(editor.explorer.row(member.name)).toBeVisible();
    await expect(editor.explorer.row(other.name)).toBeHidden();
  });

  test('a private collection is read-only for students', async ({
    createTopology,
    createStudent,
  }) => {
    const topology = await createTopology();
    const student = await createStudent([topology.collection.name]);
    const editor = new EditorPage(student.page);
    await editor.goto();
    await editor.explorer.expand(topology.collection.name);

    // The buttons only show up on hover, but they are disabled either way
    await editor.explorer.row(topology.collection.name).hover();
    await expect(
      editor.explorer
        .row(topology.collection.name)
        .getByRole('button', {name: 'Add Topology'}),
    ).toBeDisabled();
    await editor.explorer.row(topology.name).hover();
    for (const action of [
      'Edit Topology',
      'Delete Topology',
      'Deploy Topology',
    ]) {
      await expect(
        editor.explorer.row(topology.name).getByRole('button', {name: action}),
      ).toBeDisabled();
    }
  });

  test("a student can't edit a topology they didn't create", async ({
    createCollection,
    createTopology,
    createStudent,
  }) => {
    const collection = await createCollection({publicWrite: true});
    const topology = await createTopology({collection});
    const student = await createStudent([collection.name]);
    const editor = new EditorPage(student.page);
    await editor.goto(topology.id);
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain(topology.name);

    await setEditorText(editor.editor.monaco, 'name: changed\n');

    // The editor is read-only, so nothing changes and there is nothing to save
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain(topology.name);
    await expect(editor.editor.unsavedBadge).toBeHidden();
  });

  test('a student can create topologies in a publicWrite collection', async ({
    api,
    createCollection,
    createStudent,
    uniqueName,
  }) => {
    const collection = await createCollection({publicWrite: true});
    const student = await createStudent([collection.name]);
    const name = uniqueName('topology');
    const editor = new EditorPage(student.page);
    await editor.goto();

    await editor.explorer.rowAction(collection.name, 'Add Topology');
    const dialog = new Dialog(student.page, 'Add Topology');
    await dialog.fill('Topology Name', name);
    await dialog.button('Apply').click();

    await expect(
      toast(student.page, 'Topology has been created successfully.'),
    ).toBeVisible();
    const topologies = await api.getTopologies();
    expect(topologies.some(t => t.definition.includes(`name: ${name}`))).toBe(
      true,
    );
  });

  test('a student can deploy in a publicDeploy collection', async ({
    api,
    createCollection,
    createTopology,
    createStudent,
    uniqueName,
  }) => {
    const collection = await createCollection({publicDeploy: true});
    const topology = await createTopology({collection});
    const student = await createStudent([collection.name]);
    const labName = uniqueName('lab');
    const editor = new EditorPage(student.page);
    await editor.goto();
    await editor.explorer.expand(collection.name);

    await editor.explorer.rowAction(topology.name, 'Deploy Topology');
    const dialog = new Dialog(student.page, 'Deploy Topology');
    await dialog.fill('Lab Name', labName);
    await dialog.button('Deploy').click();

    await expect(
      toast(student.page, 'Lab has been created successfully.'),
    ).toBeVisible();
    const lab = await api.findLab(labName);
    expect(lab?.topologyId).toBe(topology.id);
  });

  test('a student loses access when their collection is deleted', async ({
    api,
    createCollection,
    createStudent,
  }) => {
    const collection = await createCollection();
    const student = await createStudent([collection.name]);
    const editor = new EditorPage(student.page);
    await editor.goto();
    await expect(editor.explorer.row(collection.name)).toBeVisible();

    await api.deleteCollection(collection.id);
    await student.page.reload();

    // It was the student's only collection, so the editor is gone as well
    await expect(
      student.page.getByText('You do not have access to this page'),
    ).toBeVisible();
  });
});
