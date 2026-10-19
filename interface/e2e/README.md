# End-to-end tests

Playwright tests that drive the real interface in a browser against a real Antimony server. The server
runs with the dummy deployment provider, so labs are "deployed" in memory: nothing is started, but the
interface sees the same API calls, socket events, logs and shells as with a real provider.

## Running the tests

Prerequisites:

- The server, one of:
  - **A checkout of antimony-server** next to this repository (as `antimony-server` or
    `antimony-backend`), and Go. The tests build and run it directly, no Docker image needed. Set
    `SB_E2E_SERVER_DIR` if the checkout is somewhere else.
  - **A server image**, e.g. `SB_E2E_BACKEND_IMAGE=ghcr.io/antimony-team/antimony-server:dev yarn e2e`,
    or a local one built with `docker build -t antimony-server:dev .`. CI uses the published `:dev`
    image.
- The Playwright browser, once: `npx playwright install chromium`

Commands:

| Command                           | What it does                                                     |
|-----------------------------------|------------------------------------------------------------------|
| `yarn e2e`                        | Runs all tests headless, like CI                                 |
| `yarn e2e e2e/specs/labs.spec.ts` | Runs one spec; add `-g "<name>"` for single tests                |
| `E2E_KNOWN_BUGS=1 yarn e2e`       | Runs the tests of known bugs as normal tests, to see them fail   |
| `task e2e-ui`                     | Opens Playwright's UI to run single tests and step through them  |
| `task e2e-report`                 | Opens the HTML report of the last run                            |

A run starts its own server (port 3200, SSH 6200) with a fresh database, and its own interface build
(port 4180), so it doesn't touch the development servers on 3100 and 5173. The server's log is in
`e2e/.tmp/backend/server.log`. Failing tests leave a screenshot, a video and a trace in the report
(`e2e/.tmp/report`). In CI, the report is uploaded as the `e2e-report` artifact.

## Layout

```
e2e/
  playwright.config.ts   test runner config, starts the server and the interface
  settings.ts            ports, URLs and browser options shared by everything
  backend/               config and node kinds of the test server
  scripts/               start / clean up the server
  auth.setup.ts          logs in as the admin once, all tests reuse the session
  fixtures/              the API client and the test fixtures
  pages/                 page objects: how to find and operate parts of the UI
  helpers/               Monaco editor, Cytoscape graphs, ZIP archives
  specs/                 the tests, one file per area
```

| Spec                  | Covers                                                                      |
|-----------------------|-----------------------------------------------------------------------------|
| `smoke`               | The setup itself: server, interface, fixtures                               |
| `auth`                | Login form, wrong credentials, logout, sessions                             |
| `connection`          | Network error screen, connection banner, recovery                           |
| `dock`                | Navigation, status messages, credits, the editor tour, 404 and 403 pages    |
| `dashboard`           | Lab groups, filters, collections, empty states, opening labs                |
| `labs`                | Creating labs (single and several), validation, the schedule                |
| `lab-view`            | Deploying, destroying, properties, nodes, logs, terminals                   |
| `collections`         | Creating, editing and deleting collections                                  |
| `topologies`          | Creating, renaming, duplicating, moving and deleting topologies             |
| `bind-files`          | Files and directories of a topology, archive upload                         |
| `code-editor`         | YAML and annotation files, validation, saving, undo, views, downloads, sync |
| `graph-editor`        | Nodes, links, groups, shapes, lines, texts, selection, zoom                 |
| `permissions`         | What users who aren't admins may do, on the server and in the interface    |
| `policy`              | The topology policy for unsafe topologies                                   |
| `desktop`             | The interface as Antimony Desktop runs it, with the desktop login          |
| `server`              | Server rules the interface relies on but can't show                         |

## Writing tests

- Create the data a test needs through the fixtures (`fixtures/test.ts`), and use the UI only for what
  the test is about:
  - `createCollection`, `createTopology` and `createLab` create data with unique names, as the admin or,
    with `by`, as another user. `createLab({deployed: true})` deploys the lab right away.
  - `createUser({collections})` creates a user who isn't an admin and is a member of the given
    collections, with their own API client. `loginAs` also opens a browser page logged in as them.
  - Everything the fixtures create is deleted after the test, running labs are destroyed first.
- Every browser context starts with the editor tour marked as done and all lab groups expanded, so
  neither gets in the way. Tests of these features change the state themselves.
- Find elements by role and label where possible (`getByRole('button', {name: 'Deploy lab'})`), and
  put the details into page objects. Many buttons have an icon whose name is part of their text, e.g.
  "network_node" in the editor's title: check text with a regular expression or `toContainText`.
- Never wait for a fixed time. `expect(...)` and `expect.poll(...)` retry until the condition holds.
  The only exceptions are tests that check that something does *not* happen.
- Changes in the graph editor are checked in the annotations the server stores
  (`api.getAnnotations(topologyId)`), since that's what other tools read.

## Known bugs

Tests of bugs that aren't fixed yet assert the correct behaviour and start with `knownBug('…')`, which
marks them as expected to fail, so the suite stays green. When a bug gets fixed, Playwright reports the
test as unexpectedly passing; then remove the `knownBug()` line. Run `E2E_KNOWN_BUGS=1 yarn e2e` to see
these tests fail, and check that they fail for the reason they describe. All known bugs are listed in
`BUGS.md` in the repository root.
