import {action, computed, observable, runInAction} from 'mobx';

import {oneOf, readPersistentValue} from '@sb/lib/utils/persistent-state';

export type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = 'sb:colorScheme';
const isColorScheme = oneOf('light', 'dark');

export class ThemeStore {
  @observable accessor systemScheme: ColorScheme;
  @observable accessor override: ColorScheme | null;

  constructor() {
    // Missing where there is no rendering, like in unit test runs
    const query = window.matchMedia?.('(prefers-color-scheme: light)');

    this.systemScheme = query?.matches ? 'light' : 'dark';
    this.override = readPersistentValue('colorScheme', isColorScheme);
    this.apply();

    query?.addEventListener('change', event => {
      runInAction(() => (this.systemScheme = event.matches ? 'light' : 'dark'));
    });
  }

  @computed
  public get scheme(): ColorScheme {
    return this.override ?? this.systemScheme;
  }

  /**
   * Switches to the other scheme. Switching back to the system's scheme
   * removes the override, so the interface follows the system again.
   */
  @action
  public toggle() {
    const next = this.scheme === 'light' ? 'dark' : 'light';
    this.override = next === this.systemScheme ? null : next;

    try {
      if (this.override) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.override));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage blocked: the scheme still applies for this session
    }
    this.apply();
  }

  private apply() {
    if (this.override) {
      document.documentElement.dataset.theme = this.override;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }
}
