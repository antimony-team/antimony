# Known bugs

Found while writing the end-to-end tests (October 2026). Each entry says how it was confirmed:

- **verified**: reproduced by an e2e test. The test asserts the correct behaviour and starts with
  `knownBug('…')`, so it's expected to fail and the suite stays green. Once the bug is fixed, Playwright
  reports the test as unexpectedly passing; then remove the `knownBug()` line. `E2E_KNOWN_BUGS=1 yarn e2e`
  runs these tests as normal tests, to see them fail.
- **from the code**: found by reading the code, not covered by a test.

Paths are relative to `src/`. Server bugs are tracked in the server repository's `BUGS.md`.

---

## Interface

No open bugs.

---

## Not bugs, but worth knowing

- Members may open terminals on other members' labs, but only the lab's creator (and admins) may deploy,
  destroy or start and stop its nodes.
- Saving a change made in the graph writes the whole YAML back, in block style.
- Sync URL: "Fetch" is only enabled once the topology has a saved sync URL.
- "Clear graph" removes all nodes without asking (it can be undone).
- The topology dialog fills in the collection a moment after it opens.
