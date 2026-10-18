import {InstanceState} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {clickGraphNode, graphEdges, graphNodes} from '../helpers/cytoscape';
import {ConfirmDialog, contextMenu, toast} from '../pages/dialogs';
import {LabView, LogDialog, TerminalDialog} from '../pages/lab-view';

/*
 * A lab's own view: deploying and destroying it, its properties, the live graph, the node drawer, logs
 * and terminals. The dummy provider "deploys" in about a second, and its shells echo what is typed.
 */

test.describe('deploying', () => {
  test('a lab can be deployed and destroyed', async ({
    page,
    api,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);

    await expect
      .poll(() => graphNodes(labView.graph))
      .toEqual(['host1', 'host2']);
    await expect(labView.state).toBeHidden();

    await labView.deploy();
    await expect(labView.state).toHaveText('deploying');
    await expect(labView.state).toHaveText('running');
    await expect(labView.header).toContainText('up');

    await labView.destroyButton.click();
    const confirm = new ConfirmDialog(page);
    await expect(confirm.header).toHaveText(`Destroy lab '${lab.name}'?`);
    await confirm.accept();

    await expect(labView.deployButton).toBeVisible();
    expect((await api.getLab(lab.id)).instance).toBeNull();
  });

  test('a running lab can be redeployed', async ({page, api, createLab}) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await expect(labView.state).toHaveText('running');

    await labView.redeployButton.click();

    await expect(labView.state).toHaveText('deploying');
    await expect(labView.state).toHaveText('running');
    expect((await api.getLab(lab.id)).instance?.state).toBe(
      InstanceState.Running,
    );
  });

  test('destroying can be cancelled', async ({page, api, createLab}) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);

    await labView.destroyButton.click();
    await new ConfirmDialog(page).reject();

    await expect(labView.state).toHaveText('running');
    expect((await api.getLab(lab.id)).instance).not.toBeNull();
  });

  test('the graph background menu has the lab actions', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);
    await expect.poll(() => graphNodes(labView.graph)).toHaveLength(2);

    await labView.backgroundMenu('Deploy lab');

    await expect(labView.state).toHaveText('running');
  });

  test('a running lab shows its end time and owner', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({endTime: null, deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);

    await expect(labView.header).toContainText('indefinitely');
    await expect(labView.header).toContainText('Admin');
  });
});

test.describe('properties', () => {
  test('the panel shows the lab, its topology and the provider', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);

    await expect(labView.property('ID')).toContainText(lab.id);
    await expect(labView.property('Collection')).toContainText(
      lab.topology.collection.name,
    );
    await expect(labView.property('Owner')).toContainText('Admin');
    await expect(labView.property('Provider')).toContainText('dummy');
    await expect(labView.property('Topology')).toContainText(lab.topology.name);
    await expect(labView.property('Topology')).toContainText('2 nodes');
    await expect(labView.property('Topology')).toContainText('1 link');
  });

  test('Open topology opens the lab topology in the editor', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);

    await labView.properties
      .getByRole('button', {name: 'Open topology'})
      .click();

    await expect(page).toHaveURL(new RegExp(`#/editor\\?f=${lab.topology.id}`));
  });

  test('Copy link copies the link of the lab', async ({page, createLab}) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);

    await labView.properties.getByRole('button', {name: 'Copy link'}).click();

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`?l=${lab.id}`);
  });

  test('a lab that never ran shows no deployment time', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);

    await expect(labView.property('Deployed')).toHaveText('N/A');
  });
});

test.describe('nodes', () => {
  test('clicking a node shows its details and statistics', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);

    await labView.clickNode('host1');

    const drawer = labView.drawer;
    await expect(drawer.title).toHaveText('host1');
    await expect(drawer.property('Kind')).toHaveText('linux');
    await expect(drawer.property('Container ID')).toHaveText('container-host1');
    await expect(drawer.property('Mgmt IPv4')).toContainText('172.20.20.2');
    await expect(drawer.plot('CPU')).toBeVisible();
    await expect(drawer.plot('Memory usage')).toBeVisible();
  });

  test('a node can be shut down, started and restarted', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.clickNode('host1');
    const drawer = labView.drawer;
    await expect(drawer.state).toHaveText(/running/i);

    await drawer.button('Shutdown').click();
    await expect(drawer.state).toHaveText(/stopped/i);
    await expect(drawer.button('Start')).toBeVisible();

    await drawer.button('Start').click();
    await expect(drawer.state).toHaveText(/running/i);

    await drawer.button('Restart').click();
    await expect(drawer.state).toHaveText(/running/i);
  });

  test('the node menu stops and starts a node', async ({
    page,
    api,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await expect.poll(() => graphNodes(labView.graph)).toHaveLength(2);

    const nodeState = async () =>
      (await api.getLab(lab.id)).instance?.nodes.find(n => n.name === 'host2')
        ?.state;

    await labView.nodeMenu('host2', 'Stop node');
    await expect.poll(nodeState).toBe(0);

    await labView.nodeMenu('host2', 'Start node');
    await expect.poll(nodeState).toBe(2);
  });

  test('nodes of kinds that can not restart have no start and stop', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({
      deployed: true,
      definition: name =>
        `name: ${name}\ntopology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n      image: ghcr.io/nokia/srlinux\n`,
      annotations: '{}',
    });
    const labView = new LabView(page);
    await labView.open(lab.id);

    await labView.clickNode('srl1');

    await expect(
      page.getByText(
        "Nodes with kind 'nokia_srlinux' can't be manually started",
      ),
    ).toBeVisible();
  });

  test('the SSH command of a node can be copied', async ({page, createLab}) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await expect.poll(() => graphNodes(labView.graph)).toHaveLength(2);

    await labView.nodeMenu('host1', 'Copy SSH command');

    await expect(toast(page, 'Command copied to clipboard!')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        `ssh ${lab.topology.collection.name}/${lab.name}/host1@127.0.0.1 -p 6200`,
      );
  });

  test('the graph shows the links of the topology', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({nodes: ['a', 'b', 'c']});
    const labView = new LabView(page);
    await labView.open(lab.id);

    await expect
      .poll(() => graphEdges(labView.graph))
      .toEqual([
        ['a', 'b'],
        ['b', 'c'],
      ]);
  });
});

test.describe('logs', () => {
  test('the lab log shows the deployment', async ({page, createLab}) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);

    await labView.logsButton.click();

    const logs = new LogDialog(page);
    await expect(logs.root).toContainText(lab.name);
    await expect(logs.content).toContainText('Deploying lab');
    await expect(logs.content).toContainText('nodes ready');
  });

  test("a node's container log can be selected", async ({page, createLab}) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.logsButton.click();
    const logs = new LogDialog(page);

    await logs.selectSource('host2');

    await expect(logs.content).toContainText(
      '[dummy] host2: container is ready',
    );
  });

  test('the node drawer opens the node log', async ({page, createLab}) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.clickNode('host1');

    await labView.drawer.button('Node logs').click();

    await expect(new LogDialog(page).content).toContainText(
      '[dummy] host1: container is ready',
    );
  });

  test('a lab that never ran has no logs to show', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);

    await expect(labView.logsButton).toBeDisabled();
  });
});

test.describe('terminals', () => {
  test('a terminal shows the prompt and echoes input', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.clickNode('host1');

    await labView.drawer.button('Open terminal').click();

    const terminal = new TerminalDialog(page);
    await expect(terminal.tab('host1')).toBeVisible();
    await expect(terminal.screen).toContainText('Connected to host1');
    await expect(terminal.screen).toContainText('host1:~$');

    await terminal.type('show version');
    await expect(terminal.screen).toContainText('show version');
  });

  test('several terminals can be open, and closed again', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.nodeMenu('host1', 'Open terminal');
    const terminal = new TerminalDialog(page);
    await expect(terminal.tabs).toHaveCount(1);

    await terminal.openNew('host2');
    await expect(terminal.tabs).toHaveCount(2);
    await expect(terminal.screen).toContainText('host2:~$');

    await terminal.tab('host1').click();
    await expect(terminal.screen).toContainText('host1:~$');

    await terminal.closeTab('host2');
    await expect(terminal.tabs).toHaveCount(1);
    await expect(terminal.tab('host2')).toHaveCount(0);
  });

  test('nodes of a lab that is not running have no menu', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);
    await expect.poll(() => graphNodes(labView.graph)).toHaveLength(2);

    await clickGraphNode(labView.graph, 'host1', {button: 'right'});

    await expect(contextMenu(page)).toBeHidden();
  });
});
