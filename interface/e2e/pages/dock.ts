import {Locator, Page} from '@playwright/test';

/** The bar at the top of every page once the user is logged in. */
export class Dock {
  readonly dashboard: Locator;
  readonly editor: Locator;
  readonly messages: Locator;
  readonly schedule: Locator;
  readonly credits: Locator;
  readonly logout: Locator;

  // The red badge on the bell when there are unread status messages
  readonly unreadBadge: Locator;

  constructor(private readonly page: Page) {
    this.dashboard = page.getByRole('button', {name: 'Dashboard Page'});
    this.editor = page.getByRole('button', {name: 'Topology Editor Page'});
    this.messages = page.getByRole('button', {name: 'Messages'});
    this.schedule = page.getByRole('button', {name: 'Lab Schedule'});
    this.credits = page.getByRole('button', {name: 'Credits'});
    this.logout = page.getByRole('button', {name: 'Log Out'});
    this.unreadBadge = this.messages.locator('.p-badge');
  }

  /** Opens the credits dialog and returns it. */
  async openCredits(): Promise<Locator> {
    await this.credits.click();

    return this.page
      .getByRole('dialog')
      .filter({hasText: 'Deployment Provider'});
  }

  /** Opens the status message panel and returns it. */
  async openMessages(): Promise<Locator> {
    await this.messages.click();

    return this.page.locator('.sb-dock-status-messages');
  }
}
