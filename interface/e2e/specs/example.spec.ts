/*
 * A fully commented reference spec. Read this first when writing new tests.
 *
 * Every spec imports `test` and `expect` from our fixtures instead of '@playwright/test'. Our `test`
 * adds the fixtures from fixtures/test.ts (api, uniqueName, createCollection, createStudent) to the
 * ones Playwright provides (page, browser, ...). A test asks for what it needs as parameters.
 */
import {topologyDefinition} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {graphNodes} from '../helpers/cytoscape';
import {DashboardPage} from '../pages/dashboard-page';
import {LabView} from '../pages/lab-view';

test('a lab can be deployed and destroyed from the lab view', async ({
  page, // A browser tab, already logged in as the admin (see auth.setup.ts)
  api, // The REST API, logged in as the admin
  createCollection,
  uniqueName,
}) => {
  /*
   * Arrange: create the data through the API. This is fast and keeps the test independent of other
   * tests. Everything gets a unique name, because all tests share one backend.
   */
  const collection = await createCollection({publicDeploy: true});
  const topologyId = await api.createTopology(
    collection.id,
    topologyDefinition(uniqueName('topology'), ['host1', 'host2']),
  );
  // Starts in an hour without an end time, so the scheduler leaves it alone during the test
  const labName = uniqueName('lab');
  const labId = await api.createLab(topologyId, labName);

  /*
   * Act and assert through the UI. Page objects (pages/) hide how elements are found, so the test
   * reads like what a user does.
   */
  const labView = new LabView(page);
  // Searches for the lab on the dashboard and clicks its card
  await labView.open(labId, labName);

  // The graph is drawn on a canvas, so the helper asks Cytoscape for its nodes
  await expect
    .poll(() => graphNodes(labView.graph))
    .toEqual(expect.arrayContaining(['host1', 'host2']));

  await labView.deploy();

  /*
   * expect(...) retries until the condition holds or the timeout (5s) passes. State changes arrive
   * over the `lab-updates` socket, so there is no fixed point in time to check them; never use
   * waitForTimeout. The dummy provider takes about a second to deploy, long enough to see this.
   */
  await expect(labView.state).toHaveText('deploying');
  await expect(labView.state).toHaveText('running');

  await labView.destroy();

  // Back on the dashboard, the card shows the lab without an instance again
  await labView.close();
  await expect(new DashboardPage(page).labState(labId)).toHaveText('Inactive');
});
