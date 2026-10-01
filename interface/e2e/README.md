# End-to-end tests

Playwright tests that drive the real interface in a browser against a real Antimony backend. The
backend runs with the dummy deployment provider, so labs are "deployed" in memory: nothing is
started, but the interface sees the same API calls, socket events, logs and shells as with a real
provider.

## Running the tests

Prerequisites:

- Docker, and the backend image the tests run. Locally that's `antimony-backend:dev`, built in the
  backend repository with `docker build -t antimony-backend:dev .`. Rebuild it after backend
  changes. Another image can be used with `SB_E2E_BACKEND_IMAGE=<image> yarn e2e`.
- The Playwright browser, once: `npx playwright install chromium`

Commands:

| Command           | What it does                                                   |
|-------------------|----------------------------------------------------------------|
| `yarn e2e`        | Runs all tests headless, like CI                               |
| `yarn e2e:ui`     | Opens Playwright's UI to run single tests and step through them |
| `yarn e2e:report` | Opens the HTML report of the last run                          |

A run starts its own backend (port 3100) and interface build (port 4180), so it doesn't touch the
development servers on 3000 and 8080. Failing tests leave a screenshot, a video and a trace in the
report (`e2e/.tmp/report`). In CI, the report is uploaded as the `e2e-report` artifact.

## Layout

```
e2e/
  playwright.config.ts   test runner config, starts backend and interface
  settings.ts            ports, URLs and browser options shared by everything
  backend/               config and node kinds of the test backend
  scripts/               start / clean up the backend container
  auth.setup.ts          logs in as the admin once, all tests reuse the session
  fixtures/              test fixtures (api, createCollection, createLab, createStudent, ...)
  pages/                 page objects: how to find and operate parts of the UI
  helpers/               Monaco editor, Cytoscape graphs, ZIP archives
  specs/                 the tests; start with example.spec.ts
```

## Writing tests

- Read `specs/example.spec.ts` first, it explains the structure step by step.
- Create the data a test needs through the API fixtures, and use the UI only for what the test is
  about.
- Everything a test creates gets a unique name, because all tests share one backend. The fixtures
  delete what they created afterwards.
- Find elements by role and label where possible (`getByRole('button', {name: 'Deploy Lab'})`), and
  put the details into page objects.
- Never wait for a fixed time. `expect(...)` retries until the condition holds.

## Known bugs

Tests for bugs that aren't fixed yet assert the correct behaviour and are marked with
`test.fail(true, 'Known bug: ...')`, so the suite stays green. When a bug gets fixed, Playwright
reports the test as unexpectedly passing; then remove the `test.fail()` line. All known bugs are
listed in `BUGS.md` in the repository root.
