import {expect, test as setup} from '@playwright/test';

import {prepareContext} from './fixtures/test';
import {Dock} from './pages/dock';
import {LoginPage} from './pages/login-page';
import {ADMIN, ADMIN_STORAGE_STATE} from './settings';

/*
 * Logs in as the admin through the real login form once and stores the session (cookies and
 * localStorage), so every other test starts out logged in. The stored localStorage includes the UI state
 * from prepareContext, which the app would otherwise overwrite with its defaults on the first load.
 */
setup('log in as the admin', async ({page}) => {
  await prepareContext(page.context());
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login(ADMIN);

  await expect(new Dock(page).logout).toBeVisible();

  await page.context().storageState({path: ADMIN_STORAGE_STATE});
});
