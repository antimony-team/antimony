import {expect, test} from '../fixtures/test';
import {Dialog, toast} from '../pages/dialogs';
import {Dock} from '../pages/dock';

const HOUR = 60 * 60 * 1000;

/** Opens the lab schedule in its agenda view, which lists every lab of the next weeks. */
async function openAgenda(
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
) {
  await page.goto('/');
  await new Dock(page).schedule.click();
  const schedule = new Dialog(page, 'Lab Schedule');
  await schedule.root.getByRole('button', {name: 'Agenda'}).click();

  return schedule;
}

test.describe('lab schedule', () => {
  test('a scheduled lab is listed', async ({page, createLab}) => {
    const lab = await createLab({
      startTime: new Date(Date.now() + HOUR),
      endTime: new Date(Date.now() + 3 * HOUR),
    });

    const schedule = await openAgenda(page);

    await expect(schedule.root.getByText(lab.name)).toBeVisible();
  });

  test('a scheduled lab can be edited from the schedule', async ({
    page,
    api,
    createLab,
    uniqueName,
  }) => {
    const lab = await createLab({
      startTime: new Date(Date.now() + HOUR),
      endTime: new Date(Date.now() + 3 * HOUR),
    });
    const newName = uniqueName('renamed');
    const schedule = await openAgenda(page);

    await schedule.root.getByText(lab.name).click();
    const dialog = new Dialog(page, 'Edit Lab');
    await dialog.fill('Lab Name', newName);
    await dialog.button('Submit').click();

    await expect(
      toast(page, 'Lab has been updated successfully.'),
    ).toBeVisible();
    expect((await api.getLabs()).find(l => l.id === lab.id)?.name).toBe(
      newName,
    );
  });

  test('times are shown unambiguously', async ({page, createLab}) => {
    test.fail(
      true,
      'Known bug: the date pickers format times with "hh" (12-hour clock) and no AM/PM',
    );

    // Tomorrow at 14:30 (the browser runs in UTC, see settings.ts)
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 1);
    start.setUTCHours(14, 30, 0, 0);
    const lab = await createLab({
      startTime: start,
      endTime: new Date(start.getTime() + 2 * HOUR),
    });
    const schedule = await openAgenda(page);

    await schedule.root.getByText(lab.name).click();
    const dialog = new Dialog(page, 'Edit Lab');

    await expect(dialog.field('Start Time')).toHaveValue(/14:30:00/, {
      timeout: 3_000,
    });
  });
});
