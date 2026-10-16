import {Page} from '@playwright/test';

import {expect, prepareContext, test} from '../fixtures/test';
import {Dock} from '../pages/dock';
import {LabView} from '../pages/lab-view';
import {BASE_URL} from '../settings';

/*
 * Antimony Desktop runs the same interface in Electron. Its preload script gives the interface the address
 * of the server it started and a token to sign in with (window.antimonyDesktop.config()). The tests put
 * the same function into a normal browser and point it at the e2e preview server, which forwards the
 * server's paths. The e2e server accepts the token through its desktop login.
 */

const DESKTOP_TOKEN = 'antimony-e2e-desktop';

async function openDesktop(
  browser: import('@playwright/test').Browser,
  token = DESKTOP_TOKEN,
): Promise<Page> {
  // No cookies: Antimony Desktop signs in with the token every time
  // Contexts created in tests start with the admin's session, so clear it explicitly
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: {cookies: [], origins: []},
  });
  await prepareContext(context);
  await context.addInitScript(
    ({serverUrl, token}) => {
      Object.defineProperty(window, 'antimonyDesktop', {
        value: {config: () => Promise.resolve({serverUrl, token})},
      });
    },
    {serverUrl: BASE_URL, token},
  );
  return context.newPage();
}

test('the app signs in by itself and has no logout', async ({browser}) => {
  const page = await openDesktop(browser);
  await page.goto('/');

  const dock = new Dock(page);
  await expect(dock.dashboard).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sign In'})).toBeHidden();
  // There's nobody else to sign in as
  await expect(dock.logout).toBeHidden();
  // It signs in as the admin
  await expect(dock.editor).toBeVisible();
  await page.context().close();
});

test('requests carry the token instead of cookies', async ({browser}) => {
  const page = await openDesktop(browser);
  const authorization = page
    .waitForRequest(request => request.url().endsWith('/collections'))
    .then(request => request.headers()['authorization']);

  await page.goto('/');

  expect(await authorization).toMatch(/^Bearer /);
  expect((await page.context().cookies()).map(c => c.name)).not.toContain(
    'accessToken',
  );
  await page.context().close();
});

test('a wrong token shows the login form', async ({browser}) => {
  const page = await openDesktop(browser, 'wrong-token');
  await page.goto('/');

  await expect(page.getByRole('button', {name: 'Sign In'})).toBeVisible();
  await page.context().close();
});

test('labs have no Copy Link and live updates work', async ({
  browser,
  api,
  createLab,
}) => {
  const lab = await createLab();
  const page = await openDesktop(browser);
  const labView = new LabView(page);
  await labView.open(lab.id);
  await expect(labView.title).toContainText(lab.name);

  // A link to the app's own window is no use to anyone
  await expect(
    labView.properties.getByRole('button', {name: 'Open Topology'}),
  ).toBeVisible();
  await expect(
    labView.properties.getByRole('button', {name: 'Copy Link'}),
  ).toBeHidden();

  // State changes arrive over Socket.IO, which also uses the token
  await api.deployLab(lab.id);
  await expect(labView.state).toHaveText('running');
  await page.context().close();
});
