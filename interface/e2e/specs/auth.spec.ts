import {expect, test} from '../fixtures/test';
import {Dock} from '../pages/dock';
import {LoginPage} from '../pages/login-page';
import {ADMIN} from '../settings';

test.describe('authentication', () => {
  // These tests start logged out, instead of with the admin session from auth.setup.ts
  test.use({storageState: {cookies: [], origins: []}});

  test('the login page is shown when logged out', async ({page}) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();

    await expect(loginPage.submit).toBeVisible();
    await expect(new Dock(page).logout).toBeHidden();
  });

  test('wrong credentials are rejected', async ({page}) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login({username: ADMIN.username, password: 'wrong'});

    await expect(loginPage.error).toHaveText('Invalid username or password');
    await expect(new Dock(page).logout).toBeHidden();
  });

  test('a user can log in and out', async ({page}) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(ADMIN);
    const dock = new Dock(page);
    await expect(dock.logout).toBeVisible();

    await dock.logout.click();

    await expect(loginPage.submit).toBeVisible();
    await expect(dock.logout).toBeHidden();
  });

  test('the session survives a reload', async ({page}) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(ADMIN);
    await expect(new Dock(page).logout).toBeVisible();

    await page.reload();

    await expect(new Dock(page).logout).toBeVisible();
    await expect(loginPage.submit).toBeHidden();
  });

  test('a student can log in with the login form', async ({
    page,
    api,
    uniqueName,
  }) => {
    const credentials = {username: uniqueName('student'), password: 'secret'};
    await api.createUser(credentials, []);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(credentials);

    const dock = new Dock(page);
    await expect(dock.logout).toBeVisible();
    // Without accessible collections there is no editor in the dock
    await expect(dock.editor).toBeHidden();
  });
});
