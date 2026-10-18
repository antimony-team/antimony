import {expect, test} from '../fixtures/test';
import {Dock} from '../pages/dock';

/*
 * What users see when the server can't be reached. Requests to the server are blocked in the browser,
 * so the server itself keeps running for the other tests.
 */

test('an unreachable server shows the network error screen', async ({page}) => {
  await page.route('**/api/**', route => route.abort());
  await page.route('**/socket.io/**', route => route.abort());

  await page.goto('/');

  await expect(page.getByText('Network error')).toBeVisible();
  await expect(
    page.getByText('Unable to connect to the Antimony server.'),
  ).toBeVisible();
});

test('the app recovers once the server is reachable again', async ({page}) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/');
  await expect(page.getByText('Network error')).toBeVisible();

  await page.unrouteAll();

  // The app retries every 5 seconds
  await expect(new Dock(page).logout).toBeVisible({timeout: 15_000});
});

test('losing the connection after logging in shows a banner', async ({
  page,
}) => {
  await page.goto('/');
  const dock = new Dock(page);
  await expect(dock.logout).toBeVisible();

  await page.route('**/api/**', route => route.abort());
  // The schedule loads the labs when it opens, which now fails
  await dock.schedule.click();

  const banner = page.locator('.sb-connection-banner');
  await expect(banner).toContainText('Antimony is experiencing network issues');
  // The app stays usable
  await expect(dock.logout).toBeVisible();

  await page.unrouteAll();
  await expect(banner).toBeHidden({timeout: 15_000});
});
