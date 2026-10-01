import {Locator, Page} from '@playwright/test';

/** The lab list on the dashboard. */
export class DashboardPage {
  readonly search: Locator;
  readonly filterButton: Locator;

  constructor(private readonly page: Page) {
    this.search = page
      .locator('.sb-dashboard-filter-search')
      .getByPlaceholder('Search');
    this.filterButton = page.getByRole('button', {name: 'Filter Labs'});
  }

  async goto() {
    await this.page.goto('/');
  }

  /**
   * Shows only labs matching the text. The list is paginated and all tests share one backend, so
   * tests search for their own lab instead of expecting it on the first page.
   */
  async searchFor(text: string) {
    await this.search.fill(text);
  }

  /** Opens a lab's view by searching for it and clicking its card, like a user would. */
  async openLab(labId: string, labName: string) {
    await this.goto();
    await this.searchFor(labName);
    await this.labCard(labId).click();
  }

  /** The card of a lab in the list. */
  labCard(labId: string): Locator {
    return this.page.locator(
      `[data-testid="lab-card"][data-lab-id="${labId}"]`,
    );
  }

  /** The state shown on a lab's card, e.g. "Running" or "Inactive". */
  labState(labId: string): Locator {
    return this.labCard(labId).locator('.lab-state-label-icon');
  }

  /** Removes a state from the state filter via the × on its chip above the list. */
  async removeStateFilter(state: string) {
    await this.page
      .getByRole('button', {name: `Remove ${state} Filter`})
      .click();
  }

  /** Toggles a state or collection filter in the filter overlay. */
  async toggleFilter(label: string) {
    await this.filterButton.click();
    await this.page
      .locator('.filter-overlay-panel .filter-chip')
      .getByText(label, {exact: true})
      .click();
    await this.page.keyboard.press('Escape');
  }
}
