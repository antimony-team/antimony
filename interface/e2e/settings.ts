import path from 'node:path';

/*
 * Settings shared by the Playwright config, the fixtures and the server start scripts.
 *
 * The ports differ from the usual development servers (backend 3000, interface 8080), so a test run
 * never talks to a backend that deploys real labs.
 */

export const E2E_DIR = import.meta.dirname;
export const TMP_DIR = path.join(E2E_DIR, '.tmp');

// The backend ports must match e2e/backend/config.yml and the published ports in
// e2e/scripts/start-backend.sh.
export const BACKEND_PORT = 3100;
export const INTERFACE_PORT = 4180;

// 127.0.0.1 rather than localhost, which may resolve to ::1 while the servers listen on IPv4 only
export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
export const BASE_URL = `http://127.0.0.1:${INTERFACE_PORT}`;

// The native admin the backend is started with
export const ADMIN = {username: 'admin', password: 'admin'};

// Browser state of the logged-in admin, written by auth.setup.ts
export const ADMIN_STORAGE_STATE = path.join(E2E_DIR, '.auth', 'admin.json');

// Applied to every browser context, including the ones the fixtures create for students
export const CONTEXT_OPTIONS = {
  locale: 'en-US',
  timezoneId: 'UTC',
  viewport: {width: 1600, height: 1000},
  // The Monaco helper pastes text, because typing it would trigger auto-indentation
  permissions: ['clipboard-read', 'clipboard-write'],
};
