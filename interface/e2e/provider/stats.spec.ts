import {expect, test} from '../fixtures/test';
import {LabView} from '../pages/lab-view';
import {runningNodes} from './topology';

/* The statistics of a node's container, which the server's monitor publishes every few seconds. */

test('the node drawer shows the statistics of the container', async ({
  page,
  createLab,
}) => {
  const lab = await createLab({definition: runningNodes, deployed: true});
  const labView = new LabView(page);
  await labView.open(lab.id);

  await labView.clickNode('host1');

  const memory = page
    .locator('.lab-details-plot')
    .filter({has: page.getByText('Memory usage', {exact: true})});
  await expect(memory.locator('.lab-details-plot-rates')).not.toHaveText(
    '0 B',
    {timeout: 15_000},
  );
  await expect(memory.getByRole('progressbar')).not.toHaveAttribute(
    'aria-valuenow',
    '0',
  );

  await expect(
    page
      .locator('.lab-details-net-plot-title')
      .getByText('eth1', {exact: true}),
  ).toBeVisible();
});
