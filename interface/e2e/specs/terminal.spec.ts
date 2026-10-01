import {expect, test} from '../fixtures/test';
import {clickGraphNode} from '../helpers/cytoscape';
import {LabView} from '../pages/lab-view';
import {TerminalDialog} from '../pages/runtime-dialogs';

/** Deploys a lab and opens a terminal on host1 from the node drawer. */
async function openTerminal(
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
  lab: {id: string; name: string},
) {
  const labView = new LabView(page);
  await labView.open(lab.id, lab.name);
  await labView.deploy();
  await expect(labView.state).toHaveText('running');
  await clickGraphNode(labView.graph, 'host1');
  await expect(labView.drawer.state).toHaveText('running');

  await labView.drawer.button('Open Terminal').click();

  return new TerminalDialog(page);
}

test.describe('terminal', () => {
  test('a terminal shows the prompt of the node', async ({page, createLab}) => {
    const lab = await createLab();

    const terminal = await openTerminal(page, lab);

    await expect(terminal.tabs).toHaveCount(1);
    await expect(terminal.tabs.first()).toContainText('host1');
    await expect.poll(() => terminal.text()).toContain('host1:~$');
  });

  test('typed input reaches the node', async ({page, createLab}) => {
    const lab = await createLab();
    const terminal = await openTerminal(page, lab);
    await expect.poll(() => terminal.text()).toContain('host1:~$');

    // The dummy provider's shell echoes the input back, so it went all the way through the socket
    await terminal.type('echo hello');
    await page.keyboard.press('Enter');

    await expect.poll(() => terminal.text()).toContain('host1:~$ echo hello');
  });

  test('several terminals can be open at once', async ({page, createLab}) => {
    const lab = await createLab();
    const terminal = await openTerminal(page, lab);
    await expect(terminal.tabs).toHaveCount(1);

    await terminal.openShell('host2');

    await expect(terminal.tabs).toHaveCount(2);
    await expect(terminal.tabs.nth(1)).toContainText('host2');
  });

  test('a terminal can be closed', async ({page, createLab}) => {
    const lab = await createLab();
    const terminal = await openTerminal(page, lab);
    await terminal.openShell('host2');
    await expect(terminal.tabs).toHaveCount(2);

    await terminal.tabs
      .nth(1)
      .getByRole('button', {name: 'Close Terminal'})
      .click();

    await expect(terminal.tabs).toHaveCount(1);
  });
});
