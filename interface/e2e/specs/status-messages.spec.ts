import {expect, test} from '../fixtures/test';
import {Dock} from '../pages/dock';
import {LabView} from '../pages/lab-view';

test.describe('status messages', () => {
  test('runtime events are reported in the dock', async ({page, createLab}) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);
    await labView.deploy();
    await expect(labView.state).toHaveText('running');

    // The backend pushes a status message when the lab is destroyed
    await labView.destroy();

    const dock = new Dock(page);
    await expect(dock.unreadBadge).toBeVisible();
    const messages = await dock.openMessages();
    await expect(messages).toContainText(
      `Successfully destroyed lab '${lab.name}'`,
    );
  });

  test('messages can be marked as read', async ({page, createLab}) => {
    const lab = await createLab();
    const labView = new LabView(page);
    await labView.open(lab.id, lab.name);
    await labView.deploy();
    await expect(labView.state).toHaveText('running');
    const dock = new Dock(page);
    await expect(dock.unreadBadge).toBeVisible();

    const messages = await dock.openMessages();
    await messages.getByRole('button', {name: 'Mark all as read'}).click();

    await expect(dock.unreadBadge).toBeHidden();
  });
});
