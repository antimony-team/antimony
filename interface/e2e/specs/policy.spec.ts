import {ApiError} from '../fixtures/api';
import {expect, knownBug, test} from '../fixtures/test';
import {DashboardPage} from '../pages/dashboard-page';
import {EditorPage} from '../pages/editor-page';
import {LabEditDialog} from '../pages/lab-edit-dialog';

/*
 * The topology policy: topologies that use features reaching beyond their own lab (privileged
 * containers, host ports, host mounts, …) may only be deployed by admins. The e2e server runs with the
 * policy on, as is the default.
 */

const unsafe = (name: string) =>
  `name: ${name}\ntopology:\n  nodes:\n    host1:\n      kind: linux\n      image: alpine:latest\n      privileged: true\n`;

test('the server reports the findings of an unsafe topology', async ({
  api,
  createTopology,
}) => {
  const topology = await createTopology({
    definition: unsafe,
    annotations: '{}',
  });
  const safe = await createTopology({collection: topology.collection});

  const findings = (await api.getTopology(topology.id)).policyFindings;
  expect(findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ruleId: 'privileged'})]),
  );
  expect((await api.getTopology(safe.id)).policyFindings ?? []).toEqual([]);
});

test('admins may deploy an unsafe topology', async ({api, createLab}) => {
  const lab = await createLab({
    definition: unsafe,
    annotations: '{}',
    deployed: true,
  });

  expect((await api.getLab(lab.id)).instance).not.toBeNull();
});

test('other users may not create labs from an unsafe topology', async ({
  createCollection,
  createTopology,
  createUser,
  uniqueName,
}) => {
  const collection = await createCollection({publicDeploy: true});
  const topology = await createTopology({
    collection,
    definition: unsafe,
    annotations: '{}',
  });
  const user = await createUser({collections: [collection]});

  const error = await user.api
    .createLab(topology.id, uniqueName('lab'))
    .catch(e => e as ApiError);

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(3005);
});

test('a user deploying an unsafe topology is told why it was refused', async ({
  createCollection,
  createTopology,
  loginAs,
  uniqueName,
}) => {
  const collection = await createCollection({publicDeploy: true});
  const topology = await createTopology({
    collection,
    definition: unsafe,
    annotations: '{}',
  });
  const user = await loginAs({collections: [collection]});
  await new DashboardPage(user.page).goto();

  await new DashboardPage(user.page).newLab.click();
  const dialog = new LabEditDialog(user.page);
  await dialog.setName(uniqueName('lab'));
  await dialog.selectTopology(topology.name);
  await dialog.submit('Deploy');

  const error = user.page.locator('.p-toast-message-error');
  await expect(error).toContainText('unsafe features');
});

test('the error for a refused lab is titled for creating, not updating', async ({
  createCollection,
  createTopology,
  loginAs,
  uniqueName,
}) => {
  knownBug(
    'errors when creating a lab are shown with the title "Failed to update lab"',
  );
  const collection = await createCollection({publicDeploy: true});
  const topology = await createTopology({
    collection,
    definition: unsafe,
    annotations: '{}',
  });
  const user = await loginAs({collections: [collection]});
  await new DashboardPage(user.page).goto();

  await new DashboardPage(user.page).newLab.click();
  const dialog = new LabEditDialog(user.page);
  await dialog.setName(uniqueName('lab'));
  await dialog.selectTopology(topology.name);
  await dialog.submit('Deploy');

  await expect(user.page.locator('.p-toast-message-error')).not.toContainText(
    'Failed to update lab',
  );
});

test('the editor warns about an unsafe topology before deploying', async ({
  page,
  createTopology,
}) => {
  knownBug(
    "the interface doesn't show policy findings anywhere, users only learn about them when deploying fails",
  );
  const topology = await createTopology({
    definition: unsafe,
    annotations: '{}',
  });
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);

  // Any notice outside the code editor about what the policy found
  await expect(
    page.getByText(/policy|unsafe|only admins/i).filter({visible: true}),
  ).not.toHaveCount(0);
});
