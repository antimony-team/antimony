import {Locator, Page} from '@playwright/test';

/**
 * The dashboard: the collections on the left (lab explorer), the lab cards in groups on the right.
 * The fixtures start every context with all groups expanded.
 */
export class DashboardPage {
  readonly explorer: Locator;
  readonly search: Locator;
  readonly grid: Locator;
  readonly title: Locator;
  readonly subtitle: Locator;
  readonly newLab: Locator;

  constructor(private readonly page: Page) {
    this.explorer = page.locator('.sb-lab-explorer');
    this.search = this.explorer.getByPlaceholder('Search labs');
    this.grid = page.locator('.sb-dashboard-container');
    this.title = page.locator('.sb-lab-grid-header-title');
    this.subtitle = page.locator('.sb-lab-grid-header-subtitle');
    this.newLab = this.grid
      .locator('.sb-lab-grid-header')
      .getByRole('button', {name: 'New lab'});
  }

  async goto() {
    await this.page.goto('/');
  }

  /** The card of a lab, found by its (unique) name. */
  card(labName: string): Locator {
    return this.page.locator('.sb-dashboard-lab-card').filter({
      has: this.page
        .locator('.sb-dashboard-lab-card-header > span:first-child')
        .getByText(labName, {exact: true}),
    });
  }

  /** The state written on a lab's card, e.g. "Running" or "Scheduled". */
  cardState(labName: string): Locator {
    return this.card(labName).locator('.sb-dashboard-lab-card-band-state');
  }

  /** A group of cards: "Active", "Scheduled" or "Inactive". */
  group(label: string): Locator {
    return this.grid.locator('.sb-lab-grid-group').filter({
      has: this.page.locator('.sb-lab-grid-group-header', {hasText: label}),
    });
  }

  groupHeader(label: string): Locator {
    return this.group(label).locator('.sb-lab-grid-group-header');
  }

  /** An entry of the lab explorer: "All labs" or a collection name. */
  explorerItem(name: string): Locator {
    return this.explorer.locator('.sb-lab-explorer-item').filter({
      has: this.page
        .locator('.sb-lab-explorer-item-label')
        .getByText(name, {exact: true}),
    });
  }

  /** A state filter chip, e.g. "Running" or "Inactive". */
  stateChip(state: string): Locator {
    return this.grid
      .locator('.sb-lab-grid-filter-chip')
      .filter({hasText: new RegExp(`^${state}$`)});
  }

  /** Opens a lab by clicking its card. */
  async openLab(labName: string) {
    await this.card(labName).click();
  }
}
