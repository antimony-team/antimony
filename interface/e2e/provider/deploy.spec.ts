import {expect, test} from '../fixtures/test';
import {LabView, LogDialog} from '../pages/lab-view';
import {labTimeout} from '../settings';
import {runningNodes, STARTED_MARKER} from './topology';

/*
 * Deploying and destroying a lab with a real provider: the nodes run as containers, and their details
 * and logs come from the provider.
 */

test('a deployed lab runs its nodes and destroying it removes them', async ({
  page,
  api,
  createLab,
}) => {
  const lab = await createLab({definition: runningNodes});
  const labView = new LabView(page);
  await labView.open(lab.id);

  await labView.deploy();
  await expect(labView.state).toHaveText('running', {timeout: labTimeout()});

  for (const node of ['host1', 'host2']) {
    await labView.clickNode(node);
    const drawer = labView.drawer;
    await expect(drawer.title).toHaveText(node);
    await expect(drawer.state).toHaveText(/running/i);
    await expect(drawer.property('Container ID')).not.toHaveText(
      /^(N\/A|Pending)$/,
    );
    await expect(drawer.property('Container name')).toContainText(node);
    await expect(drawer.property('Mgmt IPv4')).toHaveText(/\d+\.\d+\.\d+\.\d+/);

    // The link's interface is listed, the excluded ones aren't
    await expect(drawer.property('Interfaces')).toHaveText(/\beth1\b/);
    await expect(drawer.property('Interfaces')).not.toHaveText(/\blo\b/);
  }

  await labView.logsButton.click();
  const logs = new LogDialog(page);
  await expect(logs.content).toContainText('Deployment of lab was successful');
  // The provider's own output is in the log as well
  await expect
    .poll(async () => (await logs.content.innerText()).split('\n').length)
    .toBeGreaterThan(2);

  await logs.selectSource('host1');
  await expect(logs.content).toContainText(STARTED_MARKER);
  await logs.close();

  await labView.destroy();
  await expect(labView.deployButton).toBeVisible({timeout: labTimeout()});
  expect((await api.getLab(lab.id)).instance).toBeNull();
});
