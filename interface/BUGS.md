# Known bugs

Found while writing the end-to-end tests. Each entry says how it was confirmed. Bugs with a
"Test" line are reproduced by an e2e test marked with `test.fail()`: the test asserts the correct
behaviour and is expected to fail. Once a bug is fixed, Playwright reports the test as unexpectedly
passing, and the `test.fail()` line should be removed.

Status: **verified** = reproduced in the running application, **suspected** = found by reading the
code, not (yet) reproducible.

---

## Interface

### 1. Directory rename and delete affect directories with a similar name (data loss)

- **Status:** verified
- **Where:** `src/components/editor-page/topology-explorer/topology-explorer.tsx:265` (delete),
  `src/components/editor-page/topology-explorer/bind-file-edit-directory-dialog/bind-file-directory-edit-dialog.tsx` (rename)
- **What happens:** Both select the files of a directory with `filePath.startsWith(directoryPath)`,
  without a trailing `/`. With the files `node1/startup.cfg` and `node10/startup.cfg`:
  - renaming `node1` to `router1` also renames `node10/` to `router10/`
  - deleting `node1` also deletes `node10/startup.cfg`
- **Fix idea:** match `filePath.startsWith(directoryPath + '/')`.
- **Tests:** `e2e/specs/bind-files.spec.ts` › "renaming a directory leaves directories with a similar
  name alone", "deleting a directory leaves directories with a similar name alone"

### 2. Archive upload overwrites another topology's file (data corruption)

- **Status:** verified
- **Where:** `src/lib/stores/topology-store.ts:139` (`uploadArchiveFiles`)
- **What happens:** For files that already exist, the upload looks up the existing bind file by path
  across *all* topologies (`bindFileLookup.values().find(...)`), not only the target topology. If an
  earlier topology has a file with the same path, that file is overwritten and the target topology's
  file stays unchanged.
- **Fix idea:** search only `topology.bindFiles` of the target topology.
- **Related backend gap:** see backend bug 2.
- **Test:** `e2e/specs/archive-upload.spec.ts` › "overwriting a file leaves other topologies' files
  alone"

### 3. Connecting two nodes in the graph editor doesn't work

- **Status:** verified
- **Where:** `src/lib/cytoscape-styles.ts` (`.ghost-edge` style),
  `src/components/editor-page/topology-editor/node-editor/node-editor.tsx` (`onEdgeClick`)
- **What happens:** After "Connect" on a node, a dashed ghost edge is drawn from the node to the
  cursor. Its end is always exactly under the cursor, so the click on the target node hits the ghost
  edge instead. `onEdgeClick` treats a click on the ghost edge as "cancel", so the connection is never
  made. `.ghost-node` has `events: 'no'`, `.ghost-edge` doesn't.
- **Fix idea:** add `events: 'no'` to the `.ghost-edge` style.
- **Test:** `e2e/specs/node-editor.spec.ts` › "two nodes can be connected"

### 4. Deleting a collection keeps its topologies

- **Status:** verified
- **Where:** interface: confirmation in `topology-explorer.tsx` (`onDeleteCollection`); backend:
  `src/domain/collection/service.go` / `repository.go` (`Delete`)
- **What happens:** The confirmation dialog says "The following topologies will be deleted", but the
  backend only soft-deletes the collection. Its topologies (and their labs) stay in the database,
  attached to the deleted collection, and are still returned by `GET /topologies`.
- **Fix idea:** delete (or refuse to delete) collections with topologies in the backend, and make the
  dialog match.
- **Test:** `e2e/specs/collections.spec.ts` › "deleting a collection deletes its topologies, as the
  dialog says"

### 5. Downloading a bind file does nothing

- **Status:** verified
- **Where:** `src/components/editor-page/topology-editor/topology-editor.tsx:281` (`onDownload`)
- **What happens:** For an open bind file, the download looks up the topology with
  `topologyStore.lookup.get(openBindFile.id)`, the bind file's ID, which never matches, and returns
  silently.
- **Fix idea:** use `openBindFile.topologyId` (or drop the lookup, it isn't used afterwards).
- **Test:** `e2e/specs/bind-files.spec.ts` › "a bind file can be downloaded"

### 6. The archive upload dialog doesn't close after uploading

- **Status:** verified
- **Where:** `src/components/editor-page/topology-explorer/archive-upload-dialog/archive-upload-dialog.tsx`
  (`onSubmit`)
- **What happens:** "Upload" uploads the files, but the dialog stays open. Errors of the upload are
  ignored as well (`void topologyStore.uploadArchiveFiles(...)` in `topology-explorer.tsx`).
- **Test:** `e2e/specs/archive-upload.spec.ts` › "the dialog closes after uploading"

### 7. Nodes without stored positions are all drawn on the same spot

- **Status:** verified (screenshot); needs a decision whether this is intended
- **Where:** `src/lib/utils/utils.ts:87` (`generateGraph`)
- **What happens:** In the topology editor, a node's position comes only from its `graph-posX` /
  `graph-posY` labels; without them it is placed at (0, 0). Topologies that were not laid out in the
  graph editor (pasted YAML, git sync, created via the API) show all nodes stacked in the top-left
  corner of the graph, under the node toolbar. The lab view lays such topologies out automatically.
- **Fix idea:** run an automatic layout for nodes without a stored position.
- **Test:** `e2e/specs/node-editor.spec.ts` › "nodes without stored positions are spread out"

### 8. Links between nodes of different kinds get wrong interface names

- **Status:** suspected (not reproducible through the UI while bug 3 exists)
- **Where:** `src/lib/topology-manager.ts:387` (`connectNodes`)
- **What happens:** `nodeKind2` is read from `nodeName1`, so the target's interface name is derived
  from the source node's kind. Connecting a `linux` node to a `nokia_srlinux` node would produce
  `srl1:eth1` instead of `srl1:e1-1`.
- **Test:** `e2e/specs/node-editor.spec.ts` › "connecting nodes of different kinds uses the right
  interface names" (currently fails because of bug 3)

### 9. A node can probably be connected to itself

- **Status:** suspected (not reproducible through the UI while bug 3 exists)
- **Where:** `src/components/editor-page/topology-editor/node-editor/node-editor.tsx:321`
- **What happens:** `nodeConnectTarget !== nodeId` compares the ref object instead of
  `nodeConnectTarget.current`, so the check is always true and clicking the source node again would
  create a self-link.

### 10. Indefinite scheduled labs are shown as "Inactive"

- **Status:** suspected; needs a decision whether this is intended
- **Where:** `src/lib/stores/lab-store.ts:366` (`getInstanceState`)
- **What happens:** A lab without an instance is only shown as "Scheduled" if it has an end time. A
  lab that starts in the future and runs indefinitely is shown as "Inactive" until it starts.

### 11. Labs without an instance show the current time as "Deployed"

- **Status:** suspected (from the code)
- **Where:** `src/components/dashboard-page/lab-view/lab-view-panel-properties/lab-view-panel-properties.tsx`
- **What happens:** `dayjs(props.lab.instance?.deployed)` is `dayjs(undefined)`, i.e. now, for labs
  without an instance.

### 12. The build workflow fails because `.nvmrc` is missing

- **Status:** verified (GitHub Actions log)
- **Where:** `.github/workflows/build.yml` (`node-version-file: .nvmrc`)
- **What happens:** Every run since "Cleaned up CI/CD" fails with "The specified node version file at:
  …/.nvmrc does not exist". The e2e workflow pins Node 26 instead, so it is not affected.

### 13. A lab link (`#/?l=<id>`) only opens labs on the current dashboard page

- **Status:** verified
- **Where:** `src/components/dashboard-page/dashboard-page.tsx:73` (the `searchParams` effect)
- **What happens:** The lab view only opens if the lab is in `labStore.lookup`, which holds the labs
  of the current page (page size = list height / 80, about 9–11). The very first load fetches every
  lab (initial limit 1000), so the view opens for a moment, and closes again once the dashboard has
  loaded its first page. Links to labs further down the list (labs are sorted by start time) do
  nothing.
- **Fix idea:** fetch the linked lab on its own (`GET /labs/{id}`) when it isn't in the lookup.
- **Test:** `e2e/specs/labs.spec.ts` › "a lab can be opened by its link"

### 14. Right after deploying from the lab view, right-clicking a node shows no menu

- **Status:** verified
- **Where:** `src/components/dashboard-page/lab-view/lab-view.tsx:135` (`onGraphContext`), registered
  once with `cy.on('cxttap', ...)` at line 406
- **What happens:** The Cytoscape handler keeps the `props.lab` from when the graph was set up. If the
  lab had no instance then and is deployed from the open view, the handler still sees no instance and
  returns before showing the node menu. The graph's own menu (right-click on the background) works,
  and the node menu works after closing and reopening the view.
- **Fix idea:** read the current lab from a ref inside the handler, or re-register the handler when
  the lab changes.
- **Test:** `e2e/specs/nodes.spec.ts` › "the node context menu works right after deploying"

### 15. The date pickers show times on a 12-hour clock without AM/PM

- **Status:** verified
- **Where:** `src/components/common/lab-edit-dialog/lab-edit-dialog.tsx` (`formatDateTime` uses
  `YYYY-MM-DD hh:mm:ss`)
- **What happens:** `hh` is the 12-hour clock, so a lab starting at 14:30 is shown as `02:30:00`, the
  same as one starting at 2:30 at night.
- **Fix idea:** use `HH`.
- **Test:** `e2e/specs/calendar.spec.ts` › "times are shown unambiguously"

### 16. The "Add Group" button covers rows of a long explorer tree

- **Status:** verified (screenshot and an intercepted click in a test run); no stable test
- **Where:** `src/components/editor-page/topology-explorer/topology-explorer.tsx` (the
  `sb-topology-explorer-add-collection` button) and its styles
- **What happens:** The floating "+" button sits inside the scrolling content of the explorer, at the
  bottom of the panel's initial view. Once the tree is longer than the panel, it covers the action
  buttons (e.g. "Delete Collection", "Add Topology") of whichever row lies under it, and it scrolls
  along with the rows. In a test run, clicking "Delete Collection" of a collection was blocked by it.
- **Fix idea:** position the button relative to the panel (fixed / sticky), outside the scrolling
  content, or leave space for it below the tree.
- **Note:** The e2e fixtures delete what each test creates, which keeps the tree short; that's why no
  other test runs into this.


---

## Backend

### 1. The `filesystem` config section is ignored

- **Status:** verified
- **Where:** `src/config/config.go` (`yaml:"fileSystem"`), `config.default.yml` and `test/*.yml`
  (`filesystem:`)
- **What happens:** YAML keys are case-sensitive, so `filesystem:` never reaches the config. It goes
  unnoticed because the example configs use the default paths. The e2e config uses `fileSystem`.
- **Fix idea:** change either the struct tag or the example configs.

### 2. Bind file updates don't check that the file belongs to the topology in the URL

- **Status:** verified (admins only, not a security issue)
- **Where:** `PATCH /topologies/{topologyId}/files/{fileId}` (topology service, `UpdateBindFile`)
- **What happens:** An admin's `PATCH /topologies/A/files/<file of topology B>` succeeds and changes
  B's file. Non-admins get 403 either way, because access is checked on the file. This is what let
  interface bug 2 corrupt data silently instead of failing.
- **Fix idea:** reject requests where the file's topology differs from the one in the URL.

### 3. `NativeUserID` is not a valid UUID

- **Status:** verified (from the code)
- **Where:** `src/auth/manager.go` (`NativeUserID = "00000000-0000-0000-0000-00000000000"`)
- **What happens:** 35 characters instead of 36. It works because it's only ever compared as a
  string.

---

## Not bugs, but worth knowing

- Git sync: "Fetch" is only enabled once the topology has a saved sync URL, so a new URL has to be
  saved before it can be fetched.
- "Clear Graph" removes all nodes without asking for confirmation (it can be undone).
