import {expect, test} from '../fixtures/test';
import {clickGraphNode} from '../helpers/cytoscape';
import {LabView} from '../pages/lab-view';
import {LogDialog} from '../pages/runtime-dialogs';

/** Opens a lab, deploys it and waits until it runs. */
async function deployedLab(
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
  lab: {id: string; name: string},
) {
  const labView = new LabView(page);
  await labView.open(lab.id, lab.name);
  await labView.deploy();
  await expect(labView.state).toHaveText('running');

  return labView;
}

test.describe('nodes', () => {
  test('clicking a node shows its details', async ({page, createLab}) => {
    const lab = await createLab();
    const labView = await deployedLab(page, lab);

    await clickGraphNode(labView.graph, 'host1');

    await expect(labView.drawer.title).toHaveText('host1');
    await expect(labView.drawer.state).toHaveText('running');
    // Statistics come from the node's stats stream
    await expect(labView.drawer.plot('CPU')).toBeVisible();
    await expect(labView.drawer.plot('Memory Usage')).toBeVisible();
  });

  test('a node can be shut down and started again', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = await deployedLab(page, lab);
    await clickGraphNode(labView.graph, 'host1');
    await expect(labView.drawer.state).toHaveText('running');

    await labView.drawer.button('Shutdown').click();
    await expect(labView.drawer.state).toHaveText('stopped');

    await labView.drawer.button('Start').click();
    await expect(labView.drawer.state).toHaveText('running');
  });

  test('a node can be restarted', async ({page, createLab}) => {
    const lab = await createLab();
    const labView = await deployedLab(page, lab);
    await clickGraphNode(labView.graph, 'host1');
    await expect(labView.drawer.state).toHaveText('running');

    await labView.drawer.button('Restart').click();

    await labView.drawer.button('Node Logs').click();
    await expect(new LogDialog(page).content).toContainText(
      '[dummy] host1: container restarted',
    );
    await expect(labView.drawer.state).toHaveText('running');
  });

  test('a node has a context menu with its actions', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = await deployedLab(page, lab);

    // Reopened, because of the known bug below
    await labView.close();
    await labView.open(lab.id, lab.name);
    await clickGraphNode(labView.graph, 'host1', {button: 'right'});

    for (const action of [
      'Stop Node',
      'Restart Node',
      'Open Terminal',
      'Show Logs',
      'Copy Capture for eth0',
    ]) {
      await expect(labView.contextMenuItem(action)).toBeVisible();
    }
  });

  test('the node context menu works right after deploying', async ({
    page,
    createLab,
  }) => {
    test.fail(
      true,
      'Known bug: the lab view registers its Cytoscape context handler once, with the lab as it ' +
        'was then, so after deploying from the open view right-clicking a node shows nothing',
    );

    const lab = await createLab();
    const labView = await deployedLab(page, lab);

    await clickGraphNode(labView.graph, 'host1', {button: 'right'});

    await expect(labView.contextMenuItem('Stop Node')).toBeVisible({
      timeout: 3_000,
    });
  });
});
