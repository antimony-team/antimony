import {expect, test as setup} from '@playwright/test';

import {Dock} from './pages/dock';
import {LoginPage} from './pages/login-page';
import {ADMIN, ADMIN_STORAGE_STATE} from './settings';

/*
 * Logs in as the admin through the real login form once and stores the session (cookies), so every
 * other test starts out logged in.
 */
setup('log in as the admin', async ({page}) => {
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login(ADMIN);

  await expect(new Dock(page).logout).toBeVisible();

  await page.context().storageState({path: ADMIN_STORAGE_STATE});
});
