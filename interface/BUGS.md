# Known bugs

Found while writing the end-to-end tests (October 2026). Each entry says how it was confirmed:

- **verified**: reproduced by an e2e test. The test asserts the correct behaviour and starts with
  `knownBug('…')`, so it's expected to fail and the suite stays green. Once the bug is fixed, Playwright
  reports the test as unexpectedly passing; then remove the `knownBug()` line. `E2E_KNOWN_BUGS=1 yarn e2e`
  runs these tests as normal tests, to see them fail.
- **from the code**: found by reading the code, not covered by a test.

Paths are relative to `antimony-server/src/`. The SSH server's missing authentication is planned as a
separate rework and not listed here.

---

## Server

### 1. Shell control messages reach every signed-in user

- **Status:** from the code. The other namespaces (status messages, lab updates, stats) only reach admins and
  members of the lab's collection now; `/shell-control` will be rewritten later.
- **Where:** `runtime/shell/service.go` (`/shell-control`)
- **What happens:** every signed-in user receives the shell IDs, labs and nodes of all users' shells.

### 2. Access and refresh tokens are interchangeable, and logout revokes nothing

- **Status:** from the code. Planned as a separate rework (typed tokens and revocable sessions).
- **Where:** `auth/manager.go`, `transport/http/user/handler.go`
- **What happens:** any valid token with an `id` works as either. The 30-day refresh token works as a Bearer
  access token, and an access token works as a refresh token, so a leaked access token can be renewed
  forever. Logout only deletes the cookies.

---

## Not bugs, but worth knowing

- A lab deploys the copy of its topology made when it was created, and keeps the approval of the topology
  policy it got then, also when the topology or the policy settings change later (see the docs on the
  topology policy). `server.spec.ts` › "a lab deploys the topology it was created with, even once the
  topology is unsafe".
- Members may open terminals on other members' labs, but only the lab's creator (and admins) may deploy,
  destroy or start and stop its nodes.
- Saving a change made in the graph writes the whole YAML back, in block style.
- Sync URL: "Fetch" is only enabled once the topology has a saved sync URL.
- "Clear graph" removes all nodes without asking (it can be undone).
- The topology dialog fills in the collection a moment after it opens.
