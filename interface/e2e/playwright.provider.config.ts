import {defineConfig} from '@playwright/test';
import path from 'node:path';

import baseConfig from './playwright.config';
import {E2E_DIR, TMP_DIR} from './settings';

/*
 * Runs the tests in e2e/provider/ against a server that deploys with containerlab, see
 * e2e/scripts/start-backend.sh. The other specs expect the dummy provider and don't run here.
 */

// Read by start-backend.sh and by the settings in the workers
process.env.SB_E2E_PROVIDER ??= 'containerlab';

const isCI = !!process.env.CI;
const reportDir = path.join(TMP_DIR, 'provider-report');

export default defineConfig({
  ...baseConfig,
  outputDir: path.join(TMP_DIR, 'provider-test-results'),

  // Deploying a lab starts containers
  timeout: 5 * 60_000,
  expect: {timeout: 60_000},

  reporter: isCI
    ? [['github'], ['list'], ['html', {outputFolder: reportDir, open: 'never'}]]
    : [['list'], ['html', {outputFolder: reportDir, open: 'never'}]],

  projects: baseConfig.projects!.map(project =>
    project.name === 'chromium'
      ? {...project, testDir: path.join(E2E_DIR, 'provider')}
      : project,
  ),
});
