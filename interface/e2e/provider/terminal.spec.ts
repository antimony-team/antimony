import {Locator} from '@playwright/test';

import {expect, test} from '../fixtures/test';
import {LabView, TerminalDialog} from '../pages/lab-view';
import {runningNodes} from './topology';

/*
 * Shells run in the node's container. The outputs are computed by the shell, so the echoed input never
 * matches them.
 */

const FETCH_SHELLS = 5;

/** The terminal size the shell reports for a marker, as rows and columns. */
async function shellSize(screen: Locator, marker: string) {
  let size: number[] = [];
  await expect
    .poll(async () => {
      const match = new RegExp(`${marker}-(\\d+)x(\\d+)`).exec(
        await screen.innerText(),
      );
      size = match ? [Number(match[1]), Number(match[2])] : [];
      return size.length;
    })
    .toBe(2);
  return size;
}

test('a terminal runs a shell in the node', async ({page, api, createLab}) => {
  const lab = await createLab({definition: runningNodes, deployed: true});
  const labView = new LabView(page);
  await labView.open(lab.id);
  await labView.clickNode('host1');

  await labView.drawer.button('Open terminal').click();
  const terminal = new TerminalDialog(page);
  await expect(terminal.tab('host1')).toBeVisible();

  const run = async (command: string) => {
    await terminal.type(command);
    await page.keyboard.press('Enter');
  };

  await run('echo e2e-$((6*7))');
  await expect(terminal.screen).toContainText('e2e-42');

  await run('echo host-$(hostname)');
  await expect(terminal.screen).toContainText('host-host1');

  // The shell has the size of the terminal
  await run("echo before-$(stty size | tr ' ' x)");
  // Only the visible rows are in the DOM, so this is read before the earlier output scrolls away
  const [rows, cols] = await shellSize(terminal.screen, 'before');
  expect(rows).toBe(await terminal.screen.locator(':scope > div').count());

  // Making the window smaller makes the shell smaller
  const handle = terminal.root.locator('.p-resizable-handle');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y - 150, {steps: 10});
  await page.mouse.up();

  await run("echo after-$(stty size | tr ' ' x)");
  const [rowsAfter, colsAfter] = await shellSize(terminal.screen, 'after');
  expect(rowsAfter).toBeLessThan(rows);
  expect(colsAfter).toBeLessThan(cols);

  // Closing the terminal ends the shell
  await terminal.closeTab('host1');
  await expect
    .poll(
      async () =>
        ((await api.command(FETCH_SHELLS, lab.id)).payload as unknown[] | null)
          ?.length ?? 0,
    )
    .toBe(0);
});
