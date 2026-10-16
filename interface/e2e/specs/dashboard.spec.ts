import {expect, knownBug, test} from '../fixtures/test';
import {DashboardPage} from '../pages/dashboard-page';
import {LabView} from '../pages/lab-view';

/*
 * The dashboard: lab cards grouped by state, state filters, the collection list and the empty states.
 */

test('labs are grouped into Active, Scheduled and Inactive', async ({
  page,
  api,
  createCollection,
  createLab,
}) => {
  const collection = await createCollection();
  const running = await createLab({collection, deployed: true});
  const scheduled = await createLab({collection});

  // Starts right away, then gets destroyed: it ran, has no instance and isn't scheduled any more
  const inactive = await createLab({
    collection,
    startTime: new Date(Date.now() + 1000),
  });
  await api.waitForLab(inactive.id, lab => lab.instance?.state === 1);
  await api.destroyLab(inactive.id);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.explorerItem(collection.name).click();

  await expect(
    dashboard.group('Active').locator(dashboard.card(running.name)),
  ).toBeVisible();
  await expect(dashboard.cardState(running.name)).toHaveText('Running');

  await expect(
    dashboard.group('Scheduled').locator(dashboard.card(scheduled.name)),
  ).toBeVisible();
  await expect(dashboard.cardState(scheduled.name)).toHaveText('Scheduled');

  // A lab counts as scheduled until five seconds after its start time. The state is worked out when the
  // labs are loaded, so it takes a reload to see the change.
  await expect(async () => {
    await page.reload();
    await expect(
      dashboard.group('Inactive').locator(dashboard.card(inactive.name)),
    ).toBeVisible({timeout: 1000});
  }).toPass({timeout: 20_000});
  await expect(dashboard.cardState(inactive.name)).toHaveText('Inactive');
});

test('a lab card shows the lab, its topology and creator', async ({
  page,
  createLab,
}) => {
  const lab = await createLab({nodes: ['r1', 'r2', 'r3']});
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  const card = dashboard.card(lab.name);
  await expect(card).toContainText('3 nodes');
  await expect(card).toContainText(lab.topology.collection.name);
  await expect(card).toContainText(lab.topology.name);
  await expect(card).toContainText('Admin');
  await expect(card.locator('.sb-lab-preview')).toBeVisible();
});

test('the collection list filters the labs', async ({page, createLab}) => {
  const first = await createLab();
  const second = await createLab();
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await dashboard.explorerItem(first.topology.collection.name).click();
  await expect(dashboard.title).toHaveText(first.topology.collection.name);
  await expect(dashboard.card(first.name)).toBeVisible();
  await expect(dashboard.card(second.name)).toBeHidden();

  await dashboard.explorerItem('All labs').click();
  await expect(dashboard.title).toHaveText('All labs');
  await expect(dashboard.card(first.name)).toBeVisible();
  await expect(dashboard.card(second.name)).toBeVisible();
});

test('state chips hide the labs of a state', async ({page, createLab}) => {
  const running = await createLab({deployed: true});
  const scheduled = await createLab({
    collection: running.topology.collection,
  });
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.explorerItem(running.topology.collection.name).click();

  await dashboard.stateChip('Running').click();
  await expect(dashboard.card(running.name)).toBeHidden();
  await expect(dashboard.card(scheduled.name)).toBeVisible();

  await dashboard.stateChip('Scheduled').click();
  await expect(dashboard.card(scheduled.name)).toBeHidden();

  await dashboard.stateChip('Running').click();
  await expect(dashboard.card(running.name)).toBeVisible();
});

test('filtering out every lab offers to show all states again', async ({
  page,
  createLab,
}) => {
  const lab = await createLab();
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.explorerItem(lab.topology.collection.name).click();

  await dashboard.stateChip('Scheduled').click();
  await expect(page.getByText('All labs are filtered out')).toBeVisible();

  await page.getByRole('button', {name: 'Show all states'}).click();
  await expect(dashboard.card(lab.name)).toBeVisible();
});

test('an empty collection says so and offers a new lab', async ({
  page,
  createCollection,
  createLab,
}) => {
  // Without any lab at all, the dashboard asks to deploy the first one instead
  await createLab();
  const collection = await createCollection();
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await dashboard.explorerItem(collection.name).click();

  await expect(
    page.getByText(`No labs in ${collection.name} yet`),
  ).toBeVisible();
});

test('groups can be collapsed and stay collapsed after a reload', async ({
  page,
  createLab,
}) => {
  const lab = await createLab({deployed: true});
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await dashboard.groupHeader('Active').click();
  await expect(dashboard.groupHeader('Active')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  // A collapsed group fades out and can't be used
  await expect(
    dashboard.group('Active').locator('.sb-lab-grid-group-body'),
  ).toHaveAttribute('inert', '');

  await page.reload();
  await expect(dashboard.groupHeader('Active')).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  await dashboard.groupHeader('Active').click();
  await expect(dashboard.card(lab.name)).toBeVisible();
});

test('a collapsed Scheduled group stays collapsed after a reload', async ({
  page,
  createLab,
}) => {
  knownBug(
    'the stored groups only accept Active, Inactive and Archived, so collapsing Scheduled resets everything on reload',
  );
  await createLab();
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await dashboard.groupHeader('Scheduled').click();
  await expect(dashboard.groupHeader('Scheduled')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.reload();

  await expect(dashboard.groupHeader('Scheduled')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('the search shows only matching labs', async ({page, createLab}) => {
  const match = await createLab();
  const other = await createLab({collection: match.topology.collection});
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await expect(dashboard.card(other.name)).toBeVisible();

  await dashboard.search.fill(match.name);
  await expect(dashboard.card(match.name)).toBeVisible();
  await expect(dashboard.card(other.name)).toBeHidden();

  // The topology's name finds the lab too
  await dashboard.search.fill(other.topology.name);
  await expect(dashboard.card(other.name)).toBeVisible();
  await expect(dashboard.card(match.name)).toBeHidden();

  await dashboard.search.fill('no-lab-has-this-name');
  await expect(
    page.getByText('No labs match "no-lab-has-this-name"'),
  ).toBeVisible();
  await page.getByRole('button', {name: 'Clear search'}).click();
  await expect(dashboard.search).toHaveValue('');
  await expect(dashboard.card(match.name)).toBeVisible();
  await expect(dashboard.card(other.name)).toBeVisible();
});

test('a lab without an end time that starts later is shown as scheduled', async ({
  page,
  createLab,
}) => {
  knownBug('labs that start later and run indefinitely are shown as Inactive');
  const lab = await createLab({endTime: null});
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await expect(dashboard.cardState(lab.name)).toHaveText('Scheduled');
});

test('clicking a card opens the lab and Back returns', async ({
  page,
  createLab,
}) => {
  const lab = await createLab();
  const dashboard = new DashboardPage(page);
  await dashboard.goto();

  await dashboard.openLab(lab.name);
  const labView = new LabView(page);
  await expect(labView.root).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`l=${lab.id}`));
  await expect(page).toHaveTitle(`Antimony | ${lab.name}`);

  await labView.close();
  await expect(labView.root).toBeHidden();
  await expect(dashboard.card(lab.name)).toBeVisible();
});

test('a lab can be opened by its link', async ({page, createLab}) => {
  const lab = await createLab();
  const labView = new LabView(page);

  await labView.open(lab.id);

  await expect(labView.title).toContainText(lab.name);
});
