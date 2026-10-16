import {expect, test} from '../fixtures/test';
import {Dock} from '../pages/dock';
import {LoginPage} from '../pages/login-page';
import {ADMIN} from '../settings';

/*
 * Signing in and out with the login form. The e2e server enables the admin login and the desktop
 * login; the desktop login has no form and is tested in desktop.spec.ts.
 */

test.describe('logged out', () => {
  // A fresh browser without the admin's session
  test.use({storageState: {cookies: [], origins: []}});

  test('the login page shows the admin login form only', async ({page}) => {
    const login = new LoginPage(page);
    await login.goto();

    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await expect(login.username).toBeVisible();
    await expect(login.password).toBeVisible();
    await expect(login.submit).toBeVisible();
    // OpenID isn't enabled, so there's neither its button nor the "or" between the two
    await expect(
      page.getByRole('button', {name: 'Continue with OpenID Connect'}),
    ).toBeHidden();
    await expect(page.locator('.sb-login-divider')).toBeHidden();
  });

  test('wrong credentials are rejected', async ({page}) => {
    const login = new LoginPage(page);
    await login.goto();

    await login.login({username: ADMIN.username, password: 'wrong'});

    await expect(login.error).toHaveText('Invalid username or password');
    await expect(new Dock(page).logout).toBeHidden();
  });

  test('an unknown user is rejected', async ({page, uniqueName}) => {
    const login = new LoginPage(page);
    await login.goto();

    await login.login({username: uniqueName('nobody'), password: 'secret'});

    await expect(login.error).toHaveText('Invalid username or password');
  });

  test('the admin can log in, stays logged in and logs out', async ({page}) => {
    const login = new LoginPage(page);
    const dock = new Dock(page);
    await login.goto();

    await login.login(ADMIN);
    await expect(dock.logout).toBeVisible();
    await expect(dock.editor).toBeVisible();

    await page.reload();
    await expect(dock.logout).toBeVisible();

    await dock.logout.click();
    await expect(login.submit).toBeVisible();

    // The session is gone, not only hidden
    await page.reload();
    await expect(login.submit).toBeVisible();
    await expect(dock.logout).toBeHidden();
  });

  test('a user created by the admin can log in with the form', async ({
    page,
    createCollection,
    createUser,
  }) => {
    const collection = await createCollection();
    const user = await createUser({collections: [collection]});
    const login = new LoginPage(page);
    await login.goto();

    await login.login(user);

    const dock = new Dock(page);
    await expect(dock.logout).toBeVisible();
    // A member of a collection may use the editor
    await expect(dock.editor).toBeVisible();
  });
});
