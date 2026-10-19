import {expect, test} from '../fixtures/test';
import {Dock} from '../pages/dock';

/*
 * The bar at the top: navigation, status messages, credits, the editor tour and the error pages.
 */

test('the dock switches between the dashboard and the editor', async ({
  page,
  createTopology,
}) => {
  await createTopology();
  const dock = new Dock(page);
  await page.goto('/');

  await expect(dock.dashboard).toHaveClass(/selected/);
  await expect(page).toHaveTitle('Antimony | Dashboard');

  await dock.editor.click();
  await expect(page).toHaveURL(/#\/editor/);
  await expect(dock.editor).toHaveClass(/selected/);
  await expect(page.locator('.sb-topology-explorer')).toBeVisible();

  await dock.dashboard.click();
  await expect(page).toHaveURL(/#\/$|#\/\?/);
  await expect(dock.dashboard).toHaveClass(/selected/);

  await dock.editor.click();
  await page.locator('.sb-dock-logo').click();
  await expect(dock.dashboard).toHaveClass(/selected/);
});

test('the editor button reopens the last opened topology', async ({
  page,
  createTopology,
}) => {
  const topology = await createTopology();
  const dock = new Dock(page);

  await page.goto(`/#/editor?f=${topology.id}`);
  await expect(page.locator('.sb-topology-editor-toolbar-title')).toHaveText(
    new RegExp(`${topology.name}$`),
  );

  await dock.dashboard.click();
  await dock.editor.click();

  await expect(page).toHaveURL(new RegExp(`f=${topology.id}`));
  await expect(page.locator('.sb-topology-editor-toolbar-title')).toHaveText(
    new RegExp(`${topology.name}$`),
  );
});

test('the credits show the deployment provider', async ({page}) => {
  await page.goto('/');

  const credits = await new Dock(page).openCredits();
  await expect(credits).toContainText('Deployment provider');
  await expect(credits).toContainText('dummy');

  await credits.getByRole('button', {name: 'Close'}).click();
  await expect(credits).toBeHidden();
});

test.describe('status messages', () => {
  test('lab events show up in the messages with an unread badge', async ({
    page,
    api,
    createLab,
  }) => {
    const lab = await createLab();
    const dock = new Dock(page);
    await page.goto('/');
    await expect(dock.logout).toBeVisible();
    await expect(dock.unreadBadge).toBeHidden();

    await api.deployLab(lab.id);

    // Server messages are also shown as a toast
    await expect(
      page
        .locator('.p-toast-message')
        .filter({hasText: `Successfully deployed lab '${lab.name}'`}),
    ).toBeVisible();
    await expect(dock.unreadBadge).toBeVisible();

    const panel = await dock.openMessages();
    const item = panel
      .locator('.sb-dock-status-messages-item-container')
      .filter({hasText: `Successfully deployed lab '${lab.name}'`});
    await expect(item).toBeVisible();
    await expect(item).toContainText('Runtime');

    await panel.getByRole('button', {name: 'Mark all as read'}).click();
    await expect(dock.unreadBadge).toBeHidden();
  });

  test('messages can be filtered by severity', async ({
    page,
    api,
    createLab,
  }) => {
    const lab = await createLab();
    const dock = new Dock(page);
    await page.goto('/');
    await expect(dock.logout).toBeVisible();

    await api.deployLab(lab.id);
    await api.destroyLab(lab.id);

    const panel = await dock.openMessages();
    const items = panel.locator('.sb-dock-status-messages-item-container');
    const deployed = items.filter({
      hasText: `Successfully deployed lab '${lab.name}'`,
    });
    const destroying = items.filter({hasText: `Destroying lab '${lab.name}'`});
    await expect(deployed).toBeVisible();
    await expect(destroying).toBeVisible();

    // Only successes
    const successChip = panel.locator('.p-chip.success');
    await successChip.click();
    await expect(successChip).toHaveClass(/selected/);
    await expect(deployed).toBeVisible();
    await expect(destroying).toBeHidden();

    // Successes and infos
    await panel.locator('.p-chip.info').click();
    await expect(destroying).toBeVisible();

    // No filter shows everything again
    await successChip.click();
    await panel.locator('.p-chip.info').click();
    await expect(deployed).toBeVisible();
    await expect(destroying).toBeVisible();
  });
});

test.describe('editor tour', () => {
  test('the tour starts by itself the first time a topology opens', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.goto('/');
    // As if the tour had never run
    await page.evaluate(() => localStorage.removeItem('sb:completed-tours'));

    await page.goto(`/#/editor?f=${topology.id}`);

    const popover = page.locator('.sb-tour-popover');
    await expect(popover).toContainText('Welcome to the topology editor');

    // Closing it counts as done, so it doesn't come back
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await page.reload();
    await expect(page.locator('.sb-topology-editor-toolbar-title')).toHaveText(
      new RegExp(`${topology.name}$`),
    );
    await expect(popover).toBeHidden();
  });

  test('the tour can be started again and walked through', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.goto(`/#/editor?f=${topology.id}`);

    await page.getByRole('button', {name: 'Show tour'}).click();

    const popover = page.locator('.sb-tour-popover');
    await expect(popover).toContainText('Welcome to the topology editor');

    // Walk through all steps by their counter ("3 of 11"); steps whose element is missing are skipped
    const progress = popover.locator('.driver-popover-progress-text');
    for (let step = 0; step < 20; step++) {
      const [current, total] = (await progress.innerText())
        .split(' of ')
        .map(Number);
      if (current === total) break;
      await popover.getByRole('button', {name: 'Next'}).click();
      await expect(progress).toHaveText(`${current + 1} of ${total}`);
    }
    await expect(popover).toContainText('That is it!');
    await popover.getByRole('button', {name: 'Done'}).click();
    await expect(popover).toBeHidden();
  });

  test('the tour button is only shown in the editor', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    await page.goto('/');
    await expect(new Dock(page).logout).toBeVisible();
    await expect(page.getByRole('button', {name: 'Show tour'})).toBeHidden();

    await page.goto(`/#/editor?f=${topology.id}`);
    await expect(page.getByRole('button', {name: 'Show tour'})).toBeVisible();
  });
});

test.describe('error pages', () => {
  test('an unknown page shows a 404', async ({page}) => {
    await page.goto('/#/does-not-exist');

    await expect(page.locator('.sb-error-screen-code')).toHaveText('404');
    await expect(page.getByText('This page does not exist')).toBeVisible();
  });

  test('the editor is forbidden for users without collections', async ({
    loginAs,
  }) => {
    const user = await loginAs();

    await user.page.goto('/#/editor');

    await expect(user.page.locator('.sb-error-screen-code')).toHaveText('403');
    await expect(
      user.page.getByText('You do not have access to this page'),
    ).toBeVisible();
  });
});
