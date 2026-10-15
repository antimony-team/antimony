import {Locator, Page} from '@playwright/test';

/** The confirmation dialog shown before destructive actions (SBConfirm). */
export class ConfirmDialog {
  readonly root: Locator;

  constructor(page: Page) {
    this.root = page.locator('.sb-confirm-dialog');
  }

  async accept() {
    await this.root.getByRole('button', {name: 'Ok'}).click();
  }

  async cancel() {
    await this.root.getByRole('button', {name: 'Cancel'}).click();
  }
}

/** A dialog (SBDialog), found by its title. */
export class Dialog {
  readonly root: Locator;

  constructor(page: Page, title: string) {
    this.root = page.getByRole('dialog', {name: title});
  }

  field(label: string): Locator {
    return this.root.getByLabel(label, {exact: true});
  }

  /**
   * Fills an input. SBInput only takes over its value on blur or Enter, so this leaves the field
   * with Tab like a user would.
   */
  async fill(label: string, value: string) {
    await this.field(label).fill(value);
    await this.field(label).press('Tab');
  }

  button(name: string): Locator {
    return this.root.getByRole('button', {name, exact: true});
  }

  /** Selects an option of a dropdown (SBDropdown), found by the dropdown's label. */
  async select(label: string, option: string) {
    // `has` is evaluated relative to the dropdown, so the label lookup must not start at the dialog
    await this.root
      .locator('.p-dropdown')
      .filter({has: this.root.page().getByLabel(label, {exact: true})})
      .click();

    const panel = this.root.page().locator('.p-dropdown-panel');
    await panel.waitFor();

    // Long lists, like the node kinds, have a search field
    const filter = panel.locator('.p-dropdown-filter');
    if ((await filter.count()) > 0) await filter.fill(option);

    await panel.getByRole('option', {name: option, exact: true}).click();
  }

  /** The message an input shows when its value is rejected. */
  validationError(): Locator {
    return this.root.page().locator('.sb-input-validation-tooltip');
  }
}

/** The toast notifications in the bottom right corner. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('.p-toast-message').filter({hasText: text});
}
