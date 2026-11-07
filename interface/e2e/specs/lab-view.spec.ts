import {Page} from '@playwright/test';

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
    await expect(confirm.root).toContainText(lab.name);
    await confirm.accept('Destroy lab');

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

  test('an inactive lab can be deleted from its view', async ({
    page,
    api,
    createLab,
  }) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id);

    await labView.deleteButton.click();
    await new ConfirmDialog(page).accept('Delete lab');

    await expect(toast(page, 'Lab has been deleted.')).toBeVisible();
    await expect(labView.root).toBeHidden();
    expect((await api.getLabs()).map(l => l.id)).not.toContain(lab.id);
  });

  test('a running lab can not be deleted from its view', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await expect(labView.state).toHaveText('running');

    await expect(labView.deleteButton).toBeHidden();
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

  test('restarting a node that can not restart says why', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({
      deployed: true,
      definition: name =>
        `name: ${name}\ntopology:\n  nodes:\n    br1:\n      kind: bridge\n`,
      annotations: '{}',
    });
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.clickNode('br1');

    await labView.drawer.button('Restart').click();

    await expect(
      toast(page, "node 'br1' can't be started, stopped or restarted"),
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
        `ssh -p 6200 -l ${lab.topology.collection.name}/${lab.name}/host1 127.0.0.1`,
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

  test('a terminal can be put in fullscreen, which gives it a link', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.nodeMenu('host1', 'Open terminal');
    const terminal = new TerminalDialog(page);
    await expect(terminal.screen).toContainText('host1:~$');

    await terminal.button('Fullscreen').click();
    await expect.poll(() => linkedShell(page)).toBeTruthy();
    const firstShell = linkedShell(page);

    // A node can have several terminals, so the link leads to the selected one
    await terminal.openNew('host1');
    await expect(terminal.tabs).toHaveCount(2);
    await expect.poll(() => linkedShell(page)).not.toBe(firstShell);

    await terminal.button('Exit fullscreen').click();
    await expect.poll(() => linkedShell(page)).toBeNull();
    await expect(terminal.tabs).toHaveCount(2);
  });

  test('a terminal link opens its terminal right away', async ({
    page,
    browser,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const link = await fullscreenTerminalLink(page, lab.id, 'host2');

    const other = await browser.newPage();
    await other.goto(link);

    const terminal = new TerminalDialog(other);
    await expect(terminal.tab('host2')).toBeVisible();
    await expect(terminal.screen).toContainText('host2:~$');
    await expect(terminal.button('Exit fullscreen')).toBeVisible();
    await other.close();
  });

  test('a link to a terminal that was closed opens nothing', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});

    await page.goto(`/#/?l=${lab.id}&t=00000000-0000-4000-8000-000000000000`);

    await expect(
      toast(page, "The terminal doesn't exist anymore."),
    ).toBeVisible();
    await expect(new TerminalDialog(page).root).toBeHidden();
    await expect.poll(() => linkedShell(page)).toBeNull();
  });

  test('closing a fullscreen terminal removes it from the link', async ({
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    await fullscreenTerminalLink(page, lab.id, 'host1');
    const terminal = new TerminalDialog(page);

    await terminal.button('Close').click();

    await expect(terminal.root).toBeHidden();
    await expect.poll(() => linkedShell(page)).toBeNull();
    await expect(new LabView(page).root).toBeVisible();
  });

  test('the terminal can be opened in a new tab', async ({
    page,
    context,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.nodeMenu('host1', 'Open terminal');
    const terminal = new TerminalDialog(page);
    await expect(terminal.screen).toContainText('host1:~$');

    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      terminal.button('Open in new tab').click(),
    ]);

    await expect.poll(() => linkedShell(newTab)).toBeTruthy();
    await expect(new TerminalDialog(newTab).screen).toContainText('host1:~$');
    // The terminal moves to the new tab
    await expect(terminal.root).toBeHidden();
  });

  test("the drawer opens a node's terminal in a new tab", async ({
    page,
    context,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const labView = new LabView(page);
    await labView.open(lab.id);
    await labView.clickNode('host1');

    const openInNewTab = async () => {
      const [newTab] = await Promise.all([
        context.waitForEvent('page'),
        labView.drawer.button('Open terminal in new tab').click(),
      ]);
      await expect.poll(() => linkedShell(newTab)).toBeTruthy();
      await expect(new TerminalDialog(newTab).screen).toContainText('host1:~$');
      return newTab;
    };

    const first = await openInNewTab();
    const second = await openInNewTab();

    // The node's open terminal is reused instead of opening another one
    expect(linkedShell(second)).toBe(linkedShell(first));
    await expect(new TerminalDialog(second).tabs).toHaveCount(1);
  });

  test('a terminal opened from a link gets the size of the window', async ({
    browser,
    page,
    createLab,
  }) => {
    const lab = await createLab({deployed: true});
    const link = await fullscreenTerminalLink(page, lab.id, 'host1');

    const other = await browser.newPage({
      viewport: {width: 1600, height: 1000},
    });
    const sentRows: number[] = [];
    other.on('websocket', socket =>
      socket.on('framesent', frame => {
        const rows = /\\"rows\\":(\d+)/.exec(String(frame.payload));
        if (rows) sentRows.push(Number(rows[1]));
      }),
    );
    await other.goto(link);
    const terminal = new TerminalDialog(other);
    await expect(terminal.screen).toContainText('host1:~$');

    // The shell must have been told the size the terminal has in the fullscreen window
    const shownRows = () => terminal.screen.locator(':scope > div').count();
    await expect.poll(async () => sentRows.at(-1)).toBe(await shownRows());
    expect(await shownRows()).toBeGreaterThan(30);
    await other.close();
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

/** The shell of the fullscreen terminal in the page's link, or null. */
function linkedShell(page: Page): string | null {
  const hash = new URL(page.url()).hash;
  return new URLSearchParams(hash.split('?')[1] ?? '').get('t');
}

/** Opens a terminal on the node in fullscreen and returns its link. */
async function fullscreenTerminalLink(
  page: Page,
  labId: string,
  node: string,
): Promise<string> {
  const labView = new LabView(page);
  await labView.open(labId);
  await labView.nodeMenu(node, 'Open terminal');
  const terminal = new TerminalDialog(page);
  await expect(terminal.screen).toContainText(`${node}:~$`);
  await terminal.button('Fullscreen').click();
  await expect.poll(() => linkedShell(page)).toBeTruthy();
  return page.url();
}
