import {Locator, Page} from '@playwright/test';

import {Dialog} from './dialogs';

/**
 * The dialog that creates labs ("Deploy topology") or edits one ("Edit lab"). It's opened from the
 * dashboard's "New lab", the editor's Deploy buttons and the schedule.
 */
export class LabEditDialog extends Dialog {
  constructor(
    page: Page,
    title: 'Deploy topology' | 'Edit lab' = 'Deploy topology',
  ) {
    super(page, title);
  }

  get name(): Locator {
    return this.root.locator('#lab-edit-name');
  }

  get start(): Locator {
    return this.root.locator('#deploy-date-start');
  }

  get end(): Locator {
    return this.root.locator('#deploy-date-end');
  }

  async setName(name: string) {
    await this.name.fill(name);
    await this.name.press('Tab');
  }

  /** Switches between "Single lab" and "Multiple labs". */
  async mode(mode: 'Single lab' | 'Multiple labs') {
    await this.root
      .locator('.sb-lab-edit-mode')
      .getByText(mode, {exact: true})
      .click();
  }

  async setInstances(count: number) {
    const input = this.root.locator('#lab-edit-instances');
    await input.fill(String(count));
    await input.press('Tab');
  }

  /** The name inputs of the single labs in "Multiple labs" mode. */
  get batchNames(): Locator {
    return this.root.locator('.sb-lab-edit-names-row input');
  }

  async selectTopology(name: string) {
    await this.select('Topology', name);
  }
}
