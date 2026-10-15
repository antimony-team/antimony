import {expect, test} from '../fixtures/test';
import {DashboardPage} from '../pages/dashboard-page';

test.describe('dashboard', () => {
  test('the search shows only matching labs', async ({page, createLab}) => {
    const first = await createLab();
    const second = await createLab({topology: first.topology});
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.searchFor(first.name);

    await expect(dashboard.labCard(first.id)).toBeVisible();
    await expect(dashboard.labCard(second.id)).toBeHidden();
  });

  test('labs can be filtered by state', async ({page, createLab}) => {
    // Not deployed and without an end time, so the lab is shown as inactive
    const lab = await createLab();
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.searchFor(lab.name);
    await expect(dashboard.labState(lab.id)).toHaveText('Inactive');

    await dashboard.removeStateFilter('Inactive');
    await expect(dashboard.labCard(lab.id)).toBeHidden();

    await dashboard.toggleFilter('Inactive');
    await expect(dashboard.labCard(lab.id)).toBeVisible();
  });

  test('labs can be filtered by collection', async ({page, createLab}) => {
    const included = await createLab();
    const excluded = await createLab();
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.toggleFilter(included.topology.collection.name);

    await dashboard.searchFor(included.name);
    await expect(dashboard.labCard(included.id)).toBeVisible();
    await dashboard.searchFor(excluded.name);
    await expect(dashboard.labCard(excluded.id)).toBeHidden();
  });

  test('the dashboard shows when no lab matches', async ({page}) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.searchFor('no lab is called like this');

    await expect(page.getByText('No labs found :(')).toBeVisible();
  });
});
