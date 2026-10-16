import {expect, knownBug, test} from '../fixtures/test';
import {DashboardPage} from '../pages/dashboard-page';
import {toast} from '../pages/dialogs';
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

  await page.getByRole('button', {name: 'Deploy Topology'}).click();
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
    const schedule = page.getByRole('dialog', {name: 'Lab Schedule'});
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
    const schedule = page.getByRole('dialog', {name: 'Lab Schedule'});
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
    const schedule = page.getByRole('dialog', {name: 'Lab Schedule'});
    await schedule.getByRole('button', {name: 'Agenda'}).click();
    await schedule.getByText(lab.name).click();

    const dialog = new LabEditDialog(page, 'Edit lab');
    // The contexts use en-US, so the 12-hour clock with AM and PM
    await expect(dialog.start).toHaveValue(/^\d{2}\/\d{2}\/\d{4} 03:00:00 PM$/);
  });
});

test('a scheduled lab can be deleted', async ({page, createLab}) => {
  knownBug("there's no way to delete a lab in the interface");
  const lab = await createLab();
  await page.goto(`/#/?l=${lab.id}`);

  await expect(
    page.locator('.sb-lab-view.open').getByRole('button', {name: /Delete/}),
  ).toBeEnabled();
});
