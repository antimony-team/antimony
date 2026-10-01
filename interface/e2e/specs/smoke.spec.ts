import {Dock} from '../pages/dock';
import {expect, test} from '../fixtures/test';

/*
 * Checks that the pipeline works end to end: the interface is served, it talks to the backend over
 * both the API and the sockets, and the backend runs with the dummy provider.
 */

test('the dashboard loads for a logged-in admin', async ({page}) => {
  await page.goto('/');

  await expect(new Dock(page).logout).toBeVisible();
  await expect(
    page.getByText('Antimony is experiencing network issues'),
  ).toBeHidden();
});

test('the backend runs with the dummy provider', async ({page}) => {
  await page.goto('/');

  const credits = await new Dock(page).openCredits();

  await expect(credits).toContainText('dummy');
});

test('a student can log in and is not an admin', async ({createStudent}) => {
  const student = await createStudent();

  await student.page.goto('/');

  // Users without accessible collections don't get the editor in the dock
  await expect(new Dock(student.page).logout).toBeVisible();
  await expect(new Dock(student.page).editor).toBeHidden();
});
