import {expect, test} from '../fixtures/test';
import {DashboardPage} from '../pages/dashboard-page';
import {LabView} from '../pages/lab-view';

test.describe('lab runtime', () => {
  test('a lab can be deployed and becomes running', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);

    await labView.deploy();

    // The dummy provider takes about a second, so the deploying state is visible
    await expect(labView.state).toHaveText('deploying');
    await expect(labView.state).toHaveText('running');
  });

  test('a running lab can be redeployed', async ({page, createLab}) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);
    await labView.deploy();
    await expect(labView.state).toHaveText('running');

    await labView.button('Redeploy Lab').click();

    await expect(labView.state).toHaveText('deploying');
    await expect(labView.state).toHaveText('running');
  });

  test('a running lab can be destroyed', async ({page, api, createLab}) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);
    await labView.deploy();
    await expect(labView.state).toHaveText('running');

    await labView.destroy();

    await expect(labView.button('Deploy Lab')).toBeVisible();
    expect((await api.findLab(lab.name))?.instance).toBeNull();

    await labView.close();
    await expect(new DashboardPage(page).labState(lab.id)).toHaveText(
      'Inactive',
    );
  });

  test('a running lab shows when it was deployed', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);
    await labView.deploy();
    await expect(labView.state).toHaveText('running');

    // The header shows the uptime and that the lab runs without an end time
    const meta = labView.root.locator('.header-meta');
    await expect(meta).toContainText('up');
    await expect(meta).toContainText('indefinitely');
  });
});
