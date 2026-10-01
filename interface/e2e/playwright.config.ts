import path from 'node:path';
import {defineConfig, devices} from '@playwright/test';

import {
  ADMIN_STORAGE_STATE,
  BACKEND_URL,
  BASE_URL,
  CONTEXT_OPTIONS,
  E2E_DIR,
  TMP_DIR,
} from './settings';

const isCI = !!process.env.CI;
const reportDir = path.join(TMP_DIR, 'report');

export default defineConfig({
  testDir: E2E_DIR,
  outputDir: path.join(TMP_DIR, 'test-results'),

  // Tests share one backend. They don't depend on each other, but run one at a time for now.
  fullyParallel: false,
  workers: 1,

  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['github'], ['list'], ['html', {outputFolder: reportDir, open: 'never'}]]
    : [['list'], ['html', {outputFolder: reportDir, open: 'never'}]],

  use: {
    baseURL: BASE_URL,
    ...CONTEXT_OPTIONS,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Logs in as the admin once and stores the session for all other tests
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: 'chromium',
      testDir: path.join(E2E_DIR, 'specs'),
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        ...CONTEXT_OPTIONS,
        storageState: ADMIN_STORAGE_STATE,
      },
    },
  ],

  webServer: [
    {
      name: 'backend',
      command: 'bash scripts/start-backend.sh',
      cwd: E2E_DIR,
      url: `${BACKEND_URL}/users/login/auth-config`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      // Stops the container. The default SIGKILL would only kill `docker run` and leave it running.
      gracefulShutdown: {signal: 'SIGTERM', timeout: 10_000},
    },
    {
      name: 'interface',
      command:
        'node_modules/.bin/vite build -c e2e/vite.e2e.config.ts --logLevel error && ' +
        'node_modules/.bin/vite preview -c e2e/vite.e2e.config.ts',
      cwd: path.join(E2E_DIR, '..'),
      url: BASE_URL,
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
