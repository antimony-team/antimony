import {expect, test} from '../fixtures/test';
import {LabView} from '../pages/lab-view';
import {LogDialog} from '../pages/runtime-dialogs';

test.describe('logs', () => {
  test('the lab log shows the deployment', async ({page, createLab}) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);
    await labView.deploy();
    await expect(labView.state).toHaveText('running');

    await labView.button('View Logs').click();

    const logs = new LogDialog(page);
    await expect(logs.root).toContainText(lab.name);
    await expect(logs.content).toContainText(
      'Deployment of lab was successful',
    );
  });

  test("a node's log can be selected", async ({page, createLab}) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);
    await labView.deploy();
    await expect(labView.state).toHaveText('running');
    await labView.button('View Logs').click();

    const logs = new LogDialog(page);
    await logs.selectSource('host1');

    // The dummy provider writes these lines when a node's log is streamed
    await expect(logs.content).toContainText(
      '[dummy] host1: container is ready',
    );
  });
});
