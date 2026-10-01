import {Locator, Page} from '@playwright/test';

import {Credentials} from '../fixtures/api';

export class LoginPage {
  readonly username: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly error: Locator;

  constructor(private readonly page: Page) {
    this.username = page.getByPlaceholder('Username');
    this.password = page.getByPlaceholder('Password');
    this.submit = page.getByRole('button', {name: 'LOG IN'});
    this.error = page.locator('.sb-login-content').getByRole('alert');
  }

  async goto() {
    await this.page.goto('/');
  }

  async login(credentials: Credentials) {
    await this.username.fill(credentials.username);
    await this.password.fill(credentials.password);
    await this.submit.click();
  }
}
