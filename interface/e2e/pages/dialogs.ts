import {Locator, Page} from '@playwright/test';

/**
 * The confirmation shown before destructive actions (SBConfirm). Its buttons depend on the action,
 * e.g. "Ok", "Delete topology" or "Discard changes".
 */
export class ConfirmDialog {
  readonly root: Locator;
  readonly header: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-confirm-dialog').filter({visible: true});
    this.header = this.root.locator('.p-dialog-title');
  }

  async accept(label: string | RegExp = 'Ok') {
    await this.root.getByRole('button', {name: label}).click();
  }

  async reject(label: string | RegExp = 'Cancel') {
    await this.root.getByRole('button', {name: label}).click();
  }

  /** Types the text some confirmations ask for, such as the path of a file to delete. */
  async typeConfirmation(text: string) {
    await this.root.getByRole('textbox').fill(text);
  }
}

/** A dialog (SBDialog), found by its title. */
export class Dialog {
  readonly root: Locator;

  constructor(page: Page, title: string | RegExp) {
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

  button(name: string | RegExp): Locator {
    return this.root.getByRole('button', {
      name,
      exact: typeof name === 'string',
    });
  }

  async submit(label: string | RegExp) {
    await this.button(label).click();
  }

  async close() {
    await this.root.getByRole('button', {name: 'Close'}).click();
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

    // Long lists, like the node kinds and topologies, have a search field
    const filter = panel.locator('.p-dropdown-filter');
    if ((await filter.count()) > 0) await filter.fill(option);

    await panel.getByRole('option', {name: option, exact: true}).click();
  }

  /** The message an input shows when its value is rejected (a tooltip next to the input). */
  validationError(): Locator {
    return this.root.page().getByRole('tooltip').filter({visible: true});
  }
}

/** The toast notifications in the bottom right corner. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('.p-toast-message').filter({hasText: text});
}

/** The context menu that is currently open (right click or a "…" button). */
export function contextMenu(page: Page): Locator {
  return page.locator('.p-contextmenu').filter({visible: true});
}

/** An entry of the open context menu. Entries may show a shortcut after their label. */
export function menuItem(page: Page, name: string | RegExp): Locator {
  return contextMenu(page).getByRole('menuitem', {
    name: typeof name === 'string' ? new RegExp(`^${escape(name)}`) : name,
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
