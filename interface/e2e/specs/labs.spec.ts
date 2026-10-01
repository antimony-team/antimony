import {expect, test} from '../fixtures/test';
import {graphNodes} from '../helpers/cytoscape';
import {ConfirmDialog, Dialog, toast} from '../pages/dialogs';
import {DashboardPage} from '../pages/dashboard-page';
import {EditorPage} from '../pages/editor-page';
import {LabView} from '../pages/lab-view';

const HOUR = 60 * 60 * 1000;

test.describe('labs', () => {
  test('a topology can be deployed from the editor', async ({
    page,
    api,
    createTopology,
    uniqueName,
  }) => {
    const topology = await createTopology();
    const labName = uniqueName('lab');
    const editor = new EditorPage(page);
    await editor.goto(topology.id);

    await editor.editor.button('Deploy Topology').click();
    const dialog = new Dialog(page, 'Deploy Topology');
    await dialog.fill('Lab Name', labName);
    // The topology is preselected and the lab starts right away by default
    await dialog.button('Deploy').click();

    await expect(
      toast(page, 'Lab has been created successfully.'),
    ).toBeVisible();

    const lab = await api.findLab(labName);
    expect(lab?.topologyId).toBe(topology.id);

    // The scheduler deploys labs whose start time has come
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.searchFor(labName);
    await expect(dashboard.labState(lab!.id)).toHaveText('Running');
  });

  test('a lab needs a name', async ({page, createTopology}) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await editor.goto(topology.id);

    await editor.editor.button('Deploy Topology').click();
    const dialog = new Dialog(page, 'Deploy Topology');
    await dialog.button('Deploy').click();

    await expect(dialog.validationError()).toHaveText("Name can't be empty");
  });

  test('a lab with a future start is scheduled', async ({page, createLab}) => {
    const lab = await createLab({
      startTime: new Date(Date.now() + HOUR),
      endTime: new Date(Date.now() + 3 * HOUR),
    });
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.searchFor(lab.name);

    await expect(dashboard.labState(lab.id)).toHaveText('Scheduled');
  });

  test('a scheduled lab can be opened', async ({page, createLab}) => {
    // Regression: the properties panel used to crash for labs without an instance
    const lab = await createLab({
      startTime: new Date(Date.now() + HOUR),
      endTime: new Date(Date.now() + 3 * HOUR),
    });
    const labView = new LabView(page);

    await labView.open(lab.id, lab.name);

    await expect(labView.root).toContainText(lab.name);
    await expect
      .poll(() => graphNodes(labView.graph))
      .toEqual(expect.arrayContaining(['host1', 'host2']));
  });

  test('a scheduled lab can be deleted', async ({page, api, createLab}) => {
    const lab = await createLab({
      startTime: new Date(Date.now() + HOUR),
      endTime: new Date(Date.now() + 3 * HOUR),
    });
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.searchFor(lab.name);

    await dashboard.labCard(lab.id).hover();
    await dashboard
      .labCard(lab.id)
      .getByRole('button', {name: 'Delete Lab'})
      .click();
    await new ConfirmDialog(page).accept();

    await expect(dashboard.labCard(lab.id)).toBeHidden();
    expect((await api.getLabs()).map(l => l.id)).not.toContain(lab.id);
  });

  test('a lab can be opened by its link', async ({page, createLab}) => {
    test.fail(
      true,
      'Known bug: the ?l= deep link only opens labs that are on the current dashboard page',
    );

    // Labs are listed by start time, so a later lab ends up after the first page
    const firstLab = await createLab();
    for (let i = 0; i < 12; i++) {
      await createLab({topology: firstLab.topology});
    }
    const lateLab = await createLab({
      topology: firstLab.topology,
      startTime: new Date(Date.now() + 24 * HOUR),
    });
    const labView = new LabView(page);

    await labView.openByLink(lateLab.id);

    // The first load fetches every lab, so the view opens briefly; it has to stay open once the
    // dashboard has loaded its first page
    await page.waitForLoadState('networkidle');
    await expect(labView.root).toContainText(lateLab.name, {timeout: 3_000});
  });
});
