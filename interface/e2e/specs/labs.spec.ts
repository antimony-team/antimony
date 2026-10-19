import {Page} from '@playwright/test';

import {AntimonyApi} from '../fixtures/api';
import {expect, Lab, LabOptions, test} from '../fixtures/test';
import {DashboardPage} from '../pages/dashboard-page';
import {ConfirmDialog, contextMenu, menuItem, toast} from '../pages/dialogs';
import {Dock} from '../pages/dock';
import {LabEditDialog} from '../pages/lab-edit-dialog';

/*
 * Creating labs with the "Deploy topology" dialog, and editing them in the schedule. The dialog's
 * default start is now, so the server deploys new labs right away.
 */

test('a lab can be created from the dashboard and starts right away', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const topology = await createTopology();
  const name = uniqueName('lab');
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await dashboard.newLab.click();
  const dialog = new LabEditDialog(page);
  await dialog.setName(name);
  await dialog.selectTopology(topology.name);
  await dialog.submit('Deploy');

  await expect(toast(page, 'Lab has been created successfully.')).toBeVisible();
  await expect(dialog.root).toBeHidden();
  await expect(dashboard.cardState(name)).toHaveText('Running');

  const lab = await api.findLab(name);
  expect(lab?.topologyId).toBe(topology.id);
  expect(lab?.endTime).not.toBeNull();
});

test('the editor deploys the open topology', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const topology = await createTopology();
  const name = uniqueName('lab');
  await page.goto(`/#/editor?f=${topology.id}`);

  await page.getByRole('button', {name: 'Deploy topology'}).click();
  const dialog = new LabEditDialog(page);
  // The open topology is selected already
  await expect(dialog.root.locator('#edit-lab-topology')).toHaveValue(
    topology.name,
  );
  await dialog.setName(name);
  await dialog.submit('Deploy');

  await expect(toast(page, 'Lab has been created successfully.')).toBeVisible();
  expect((await api.findLab(name))?.topologyId).toBe(topology.id);
});

test('several labs can be created at once', async ({
  page,
  api,
  createTopology,
  uniqueName,
}) => {
  const topology = await createTopology();
  const base = uniqueName('class');
  await page.goto('/');

  await new DashboardPage(page).newLab.click();
  const dialog = new LabEditDialog(page);
  await dialog.mode('Multiple labs');
  await dialog.setName(base);
  await dialog.setInstances(3);
  await dialog.selectTopology(topology.name);

  await expect(dialog.batchNames).toHaveCount(3);
  // One name can be changed, the others follow the base name
  await dialog.batchNames.nth(1).fill(`${base}-special`);
  await dialog.submit('Deploy 3 labs');

  await expect(
    toast(page, '3 labs have been created successfully.'),
  ).toBeVisible();
  const names = (await api.getLabs())
    .filter(lab => lab.topologyId === topology.id)
    .map(lab => lab.name)
    .sort();
  expect(names).toEqual([`${base} 1`, `${base} 3`, `${base}-special`].sort());
});

test.describe('validation', () => {
  test('a lab needs a name and a topology', async ({page}) => {
    await page.goto('/');
    await new DashboardPage(page).newLab.click();
    const dialog = new LabEditDialog(page);

    await dialog.submit('Deploy');

    await expect(dialog.validationError()).toContainText("Name can't be empty");
    await expect(dialog.root).toBeVisible();
  });

  test('a lab needs a topology', async ({page, uniqueName}) => {
    await page.goto('/');
    await new DashboardPage(page).newLab.click();
    const dialog = new LabEditDialog(page);

    await dialog.setName(uniqueName('lab'));
    await dialog.submit('Deploy');

    await expect(dialog.validationError()).toContainText(
      "You didn't select a topology",
    );
  });

  test('lab names can not contain slashes', async ({page, createTopology}) => {
    const topology = await createTopology();
    await page.goto('/');
    await new DashboardPage(page).newLab.click();
    const dialog = new LabEditDialog(page);

    await dialog.setName('a/b');
    await dialog.selectTopology(topology.name);
    await dialog.submit('Deploy');

    await expect(dialog.validationError()).toContainText(
      "Lab names can't contain slashes",
    );
  });

  test('lab names are unique within a collection', async ({
    page,
    createLab,
  }) => {
    const existing = await createLab();
    await page.goto('/');
    await new DashboardPage(page).newLab.click();
    const dialog = new LabEditDialog(page);

    await dialog.setName(existing.name);
    await dialog.selectTopology(existing.topology.name);
    await dialog.submit('Deploy');

    await expect(dialog.validationError()).toContainText(
      'A lab with that name already exists',
    );
  });
});

test.describe('schedule', () => {
  test('scheduled labs are listed in the schedule', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    await page.goto('/');

    await new Dock(page).schedule.click();
    const schedule = page.getByRole('dialog', {name: 'Lab schedule'});
    await schedule.getByRole('button', {name: 'Agenda'}).click();

    await expect(schedule.getByText(lab.name)).toBeVisible();
  });

  test('a scheduled lab can be renamed and moved from the schedule', async ({
    page,
    api,
    createLab,
    uniqueName,
  }) => {
    const lab = await createLab();
    const newName = uniqueName('renamed');
    await page.goto('/');

    await new Dock(page).schedule.click();
    const schedule = page.getByRole('dialog', {name: 'Lab schedule'});
    await schedule.getByRole('button', {name: 'Agenda'}).click();
    await schedule.getByText(lab.name).click();

    const dialog = new LabEditDialog(page, 'Edit lab');
    await expect(dialog.name).toHaveValue(lab.name);
    // Only labs created anew have a topology to choose
    await expect(dialog.root.locator('#edit-lab-topology')).toHaveCount(0);
    await dialog.setName(newName);
    await dialog.submit('Submit');

    await expect(
      toast(page, 'Lab has been updated successfully.'),
    ).toBeVisible();
    expect((await api.getLab(lab.id)).name).toBe(newName);
  });

  test("the date pickers show times in the user's locale", async ({
    page,
    createLab,
  }) => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 1);
    start.setUTCHours(15, 0, 0, 0);
    const lab = await createLab({startTime: start});
    await page.goto('/');

    await new Dock(page).schedule.click();
    const schedule = page.getByRole('dialog', {name: 'Lab schedule'});
    await schedule.getByRole('button', {name: 'Agenda'}).click();
    await schedule.getByText(lab.name).click();

    const dialog = new LabEditDialog(page, 'Edit lab');
    // The contexts use en-US, so the 12-hour clock with AM and PM
    await expect(dialog.start).toHaveValue(/^\d{2}\/\d{2}\/\d{4} 03:00:00 PM$/);
  });
});

test.describe('the lab card menu', () => {
  test('a scheduled lab can be deployed, edited or deleted', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.card(lab.name).click({button: 'right'});

    await expect(menuItem(page, 'Deploy')).toBeVisible();
    await expect(menuItem(page, 'Edit')).toBeVisible();
    await expect(menuItem(page, 'Delete')).toBeVisible();
    await expect(menuItem(page, 'Redeploy')).toHaveCount(0);
    await expect(menuItem(page, 'Destroy')).toHaveCount(0);
  });

  test('a running lab can only be redeployed or destroyed', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.card(lab.name).click({button: 'right'});

    await expect(menuItem(page, 'Redeploy')).toBeVisible();
    await expect(menuItem(page, 'Destroy')).toBeVisible();
    await expect(menuItem(page, 'Deploy')).toHaveCount(0);
    await expect(menuItem(page, 'Edit')).toHaveCount(0);
    await expect(menuItem(page, 'Delete')).toHaveCount(0);
  });

  test('Edit opens the lab in the edit dialog', async ({page, createLab}) => {
    const lab = await createLab();
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.card(lab.name).click({button: 'right'});
    await menuItem(page, 'Edit').click();

    await expect(new LabEditDialog(page, 'Edit lab').name).toHaveValue(
      lab.name,
    );
  });

  test('Delete deletes the lab after confirming', async ({
    page,
    api,
    createLab,
  }) => {
    const lab = await createLab();
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await dashboard.card(lab.name).click({button: 'right'});
    await menuItem(page, 'Delete').click();
    await new ConfirmDialog(page).accept('Delete lab');

    await expect(toast(page, 'Lab has been deleted.')).toBeVisible();
    await expect(dashboard.card(lab.name)).toHaveCount(0);
    expect((await api.getLabs()).map(l => l.id)).not.toContain(lab.id);
  });

  test("another member's lab has no menu", async ({
    createCollection,
    createLab,
    loginAs,
  }) => {
    const collection = await createCollection();
    const lab = await createLab({collection});
    const user = await loginAs({collections: [collection]});
    const dashboard = new DashboardPage(user.page);
    await dashboard.goto();

    await dashboard.card(lab.name).click({button: 'right'});

    await expect(contextMenu(user.page)).toHaveCount(0);
  });
});

test.describe('the trash icon on inactive labs', () => {
  // Starts right away, then gets destroyed: it ran, has no instance and isn't scheduled any more
  async function createInactiveLab(
    api: AntimonyApi,
    createLab: (options?: LabOptions) => Promise<Lab>,
    options: LabOptions = {},
  ) {
    const lab = await createLab({
      ...options,
      startTime: new Date(Date.now() + 1000),
    });
    await api.waitForLab(lab.id, l => l.instance?.state === 1);
    await api.destroyLab(lab.id);
    return lab;
  }

  // A lab counts as scheduled until five seconds after its start time, which only a reload shows
  async function waitUntilInactive(
    page: Page,
    dashboard: DashboardPage,
    labName: string,
  ) {
    await expect(async () => {
      await page.reload();
      await expect(dashboard.cardState(labName)).toHaveText('Inactive', {
        timeout: 1000,
      });
    }).toPass({timeout: 20_000});
  }

  test('deletes an inactive lab without asking', async ({
    page,
    api,
    createLab,
  }) => {
    const lab = await createInactiveLab(api, createLab);
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await waitUntilInactive(page, dashboard, lab.name);

    await dashboard.card(lab.name).hover();
    await dashboard
      .card(lab.name)
      .getByRole('button', {name: 'Delete lab'})
      .click();
    await expect(toast(page, 'Lab has been deleted.')).toBeVisible();

    await expect(dashboard.card(lab.name)).toHaveCount(0);
    await expect(new ConfirmDialog(page).root).toHaveCount(0);
    expect((await api.getLabs()).map(l => l.id)).not.toContain(lab.id);
  });

  test('is only shown on inactive labs', async ({page, createLab}) => {
    const scheduled = await createLab();
    const running = await createLab({deployed: true});
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    for (const lab of [scheduled, running]) {
      await dashboard.card(lab.name).hover();
      await expect(
        dashboard.card(lab.name).getByRole('button', {name: 'Delete lab'}),
      ).toHaveCount(0);
    }
  });

  test("is not shown on another member's lab", async ({
    api,
    createCollection,
    createLab,
    loginAs,
  }) => {
    const collection = await createCollection();
    const lab = await createInactiveLab(api, createLab, {collection});
    const user = await loginAs({collections: [collection]});
    const dashboard = new DashboardPage(user.page);
    await dashboard.goto();
    await waitUntilInactive(user.page, dashboard, lab.name);

    await dashboard.card(lab.name).hover();

    await expect(
      dashboard.card(lab.name).getByRole('button', {name: 'Delete lab'}),
    ).toHaveCount(0);
  });
});
