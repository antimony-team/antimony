import {expect, test} from '../fixtures/test';
import {DashboardPage} from '../pages/dashboard-page';
import {Dock} from '../pages/dock';

/*
 * Connection problems are simulated by making the browser's API requests fail with page.route.
 * The backend itself keeps running for the other tests.
 */
test.describe('connection errors', () => {
  test('an unreachable backend shows the network error screen', async ({
    page,
  }) => {
    await page.route('**/api/**', route => route.abort());

    await page.goto('/');

    await expect(page.getByText('Network Error')).toBeVisible();
    await expect(
      page.getByText('Unable to connect to the Antimony server.'),
    ).toBeVisible();
  });

  test('losing the connection after logging in shows a banner', async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(new Dock(page).logout).toBeVisible();

    await page.route('**/api/**', route => route.abort());
    // Searching fetches the lab list, which now fails
    await dashboard.searchFor('anything');

    const banner = page.getByText('Antimony is experiencing network issues');
    await expect(banner).toBeVisible();

    // The client retries every few seconds and recovers once the backend is back
    await page.unroute('**/api/**');
    await expect(banner).toBeHidden({timeout: 15_000});
  });
});
