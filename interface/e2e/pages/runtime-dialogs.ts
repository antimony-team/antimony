import {Locator, Page} from '@playwright/test';

/** The log dialog of a lab, which streams the lab's or a node's log. */
export class LogDialog {
  readonly root: Locator;
  readonly content: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-log-dialog');
    this.content = this.root.locator('.sb-log-dialog-content');
  }

  /** Switches the log source to "Antimony" (the lab log) or a node's name. */
  async selectSource(source: string) {
    await this.root.locator('.p-dropdown').click();
    await this.page
      .locator('.p-dropdown-panel')
      .getByRole('option', {name: source, exact: true})
      .click();
  }
}

/** The terminal dialog with one tab per open shell. */
export class TerminalDialog {
  readonly root: Locator;
  readonly tabs: Locator;
  readonly output: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('.sb-terminal-dialog');
    this.tabs = this.root.getByTestId('terminal-tab');
    this.output = this.root.locator('.xterm-rows');
  }

  /** The output of the active terminal, without the padding xterm uses for empty cells. */
  async text(): Promise<string> {
    const rows = await this.output.locator(':scope > div').allInnerTexts();

    return rows.map(row => row.replace(/\u00a0/g, ' ').trimEnd()).join('\n');
  }

  async type(text: string) {
    await this.root.locator('.xterm').click();
    await this.page.keyboard.type(text);
  }

  /** Opens another shell via the "+" tab, for the node with the given name. */
  async openShell(nodeName: string) {
    await this.root.getByRole('button', {name: 'Open New Terminal'}).click();
    // The nodes are listed as "<name> (<container ID>)"
    await this.page
      .locator('.sb-terminal-new-tab-overlay')
      .getByText(new RegExp(`^${nodeName} \\(`))
      .click();
  }
}
