import {expect, test} from '../fixtures/test';
import {LabView} from '../pages/lab-view';
import {runningNodes} from './topology';

/* Stopping, starting and restarting the containers of nodes from the node drawer. */

test('a node can be stopped, started and restarted', async ({
  page,
  createLab,
}) => {
  const lab = await createLab({definition: runningNodes, deployed: true});
  const labView = new LabView(page);
  await labView.open(lab.id);

  await labView.clickNode('host2');
  const drawer = labView.drawer;
  await expect(drawer.state).toHaveText(/running/i);

  await drawer.button('Shutdown').click();
  await expect(drawer.state).toHaveText(/stopped/i);
  // A stopped node has no container, and the drawer shows none of its details
  await expect(drawer.property('Container ID')).toBeHidden();
  await expect(drawer.property('Mgmt IPv4')).toBeHidden();

  await drawer.button('Start').click();
  await expect(drawer.state).toHaveText(/running/i);
  // The interfaces are known once the node is ready. Stopping a container removes its links on both ends, so
  // only eth0 is left.
  await expect(drawer.property('Interfaces')).toHaveText(/\beth0\b/);

  await labView.clickNode('host1');
  await expect(drawer.title).toHaveText('host1');
  await drawer.button('Restart').click();
  await expect(drawer.state).toHaveText(/running/i);
  await expect(drawer.property('Interfaces')).toHaveText(/\beth0\b/);
});
