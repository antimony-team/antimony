import {InstanceState} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {Dock} from '../pages/dock';

/*
 * Checks that the pipeline works end to end: the interface is served, it talks to the server over both
 * the API and the sockets, the server runs with the dummy provider, and the fixtures work.
 */

test('the dashboard loads for a logged-in admin', async ({page}) => {
  await page.goto('/');

  await expect(new Dock(page).logout).toBeVisible();
  await expect(new Dock(page).editor).toBeVisible();
  await expect(
    page.getByText('Antimony is experiencing network issues'),
  ).toBeHidden();
});

test('the server runs with the dummy provider', async ({page}) => {
  await page.goto('/');

  const credits = await new Dock(page).openCredits();

  await expect(credits).toContainText('dummy');
});

test('a user without collections can log in and is not an admin', async ({
  loginAs,
}) => {
  const user = await loginAs();

  await user.page.goto('/');

  // Users without collections don't get the editor in the dock
  await expect(new Dock(user.page).logout).toBeVisible();
  await expect(new Dock(user.page).editor).toBeHidden();
});

test('the fixtures create topologies with node positions', async ({
  api,
  createTopology,
}) => {
  const topology = await createTopology({nodes: ['r1', 'r2', 'r3']});

  const stored = await api.getTopology(topology.id);
  expect(stored.definition).toContain(`name: ${topology.name}`);
  expect(stored.collectionId).toBe(topology.collection.id);

  const annotations = await api.getAnnotations(topology.id);
  expect(annotations.nodeAnnotations?.map(node => node.id)).toEqual([
    'r1',
    'r2',
    'r3',
  ]);
});

test('the fixtures deploy labs and users see only their collections', async ({
  api,
  createCollection,
  createLab,
  createUser,
}) => {
  const collection = await createCollection();
  const lab = await createLab({collection, deployed: true});

  expect((await api.getLab(lab.id)).instance?.state).toBe(
    InstanceState.Running,
  );

  const member = await createUser({collections: [collection]});
  const outsider = await createUser();

  expect((await member.api.getLabs()).map(l => l.id)).toContain(lab.id);
  expect((await outsider.api.getLabs()).map(l => l.id)).not.toContain(lab.id);
});
