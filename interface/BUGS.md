# Known bugs

Found while writing the end-to-end tests (October 2026). Each entry says how it was confirmed:

- **verified**: reproduced by an e2e test. The test asserts the correct behaviour and starts with
  `knownBug('…')`, so it's expected to fail and the suite stays green. Once the bug is fixed, Playwright
  reports the test as unexpectedly passing; then remove the `knownBug()` line. `E2E_KNOWN_BUGS=1 yarn e2e`
  runs these tests as normal tests, to see them fail.
- **from the code**: found by reading the code, not covered by a test.
- **fixed**: fixed, and its test runs as a normal test again.

Paths of the interface are relative to `src/`, those of the server to `antimony-server/src/`.

---

## Server

### 1. The SSH server lets anyone in, without authentication (security)

- **Status:** verified — `server.spec.ts` › "the SSH server asks who is connecting"
- **Where:** `sshserver/sshserver.go` (no auth handlers, so gliderlabs/ssh allows every client), and
  `runtime/instance/service.go` (`GetInstanceNode` is called without a user)
- **What happens:** `ssh -p <port> <collection>/<lab>/<node>@<server>` opens a shell on any running node,
  for anyone who can reach the SSH port, without a password or key. The same goes for packet captures.
- **Fix idea:** authenticate SSH clients (e.g. with the user's access token as the password, or keys), and
  check the user's access to the lab like the socket namespaces do.

### 2. Every signed-in user hears about every lab

- **Status:** verified — `server.spec.ts` › "users don't hear about labs of collections they aren't in"
- **Where:** `main.go` (`/status-messages`), `runtime/instance/service.go` (`/lab-updates`),
  `runtime/instance/monitor.go` (`/stats/<id>`, no access check), `runtime/shell/service.go`
  (`/shell-control`)
- **What happens:** a user without any collection receives the status messages (lab names, internal log
  lines with lab IDs) and lab updates of all labs. From the code, `/stats/*` and `/shell-control` (shell IDs,
  labs and nodes of all users) are open to everyone as well.
- **Fix idea:** send these only to admins and members of the lab's collection.

### 3. The topology policy is only checked when a lab is created

- **Status:** verified — `server.spec.ts` › "a lab created from a safe topology can not be deployed once it
  is unsafe"
- **Where:** `domain/lab/service.go` (only `POST /labs` checks the policy), `runtime/instance/service.go`
  (socket deploy), the scheduler
- **What happens:** a user creates a lab while the topology is safe. Once the topology contains unsafe
  features (changed by its creator or an admin), the user can still deploy the lab with the Deploy button,
  and the scheduler starts it as well.
- **Fix idea:** check the policy whenever a lab is deployed by a user who isn't an admin.

### 4. Bind files and topology deletion ignore "Anyone can edit"

- **Status:** verified — `permissions.spec.ts` › "a creator can not change bind files once the collection is
  read-only"
- **Where:** `domain/topology/service.go` (bind file create, update, delete and topology delete check only
  the creator)
- **What happens:** editing a topology needs the collection to be writable, but its creator can still add,
  change and delete its bind files, and delete it, after the collection is made read-only or they lost
  their membership. Bind files can change the policy findings of a topology.
- **Fix idea:** check publicWrite and membership like the topology update does.

### 5. Destroying a lab that isn't running removes it from the schedule

- **Status:** verified — `server.spec.ts` › "destroying a lab that is not running leaves its schedule alone"
- **Where:** `runtime/instance/service.go` (`DestroyLabCommand` publishes `lab.deleted` before checking that
  the lab runs)
- **What happens:** the command fails with 5012 "lab not running", but the lab silently drops out of the
  schedule and never starts. The dashboard still shows it as Scheduled.

### 6. Pages of `GET /labs` are short for users who aren't admins

- **Status:** verified — `server.spec.ts` › "a page of labs is full for users who are not admins"
- **Where:** `domain/lab/repository.go` (limit and offset in SQL), `domain/lab/service.go` (membership filter
  afterwards)
- **What happens:** `?limit=1` returns no lab at all when the first lab in the database belongs to another
  collection. The interface doesn't page, so it's only visible to API users.

### 7. Labs can end before they start

- **Status:** verified — `server.spec.ts` › "a lab can not end before it starts"
- **Where:** `domain/lab/service.go` (create and update)
- **What happens:** `endTime` before `startTime` is accepted.

### 8. Empty lab names and collection names with a slash are accepted

- **Status:** verified — `server.spec.ts` › "collection and lab names are checked on the server"
- **Where:** `domain/lab/entity.go`, `domain/collection/entity.go` (`required` accepts `""`), no name
  validation for collections
- **What happens:** a lab can be called `""`. A collection can be called `a/b`, which breaks the SSH
  syntax `<collection>/<lab>/<node>`.

### 9. Smaller server issues, from the code

- **Bind file updates don't check the topology in the URL:** `PATCH /topologies/A/files/<file of B>`
  changes B's file (admins only). `transport/http/topology/handler.go` ignores `:topologyId`.
- **Access and refresh tokens are interchangeable, and logout revokes nothing:** any valid token with an
  `id` works as either (`auth/manager.go`). The 30-day refresh token works as a Bearer access token.
- **Socket permissions are a snapshot:** they're cached per token when a socket connects and never
  updated (`socket/manager.go`), so removed access only applies after reconnecting.
- **Admins can close other users' shells but can't attach to or list them**
  (`runtime/shell/service.go`).
- **Opening a shell on an unknown lab answers 5021 (node not found)** instead of 5011.
- **`policyFindings` is `null` instead of `[]`** for topologies without findings (`policy/engine.go`).
- **`GET /labs` with an invalid query answers 500** instead of 422, and `GET /topologies/{id}` answers 403
  instead of 404 for non-members.
- **Two tabs of the same user overwrite each other** in the socket's client map
  (`socket/namespace.go`); harmless for broadcasts.
- **Shell races:** `lastInteraction` is written without a lock, and the shell limit is counted and
  checked non-atomically (`runtime/shell/service.go`).
- **`NativeUserID` has 35 characters** instead of the 36 of a UUID (`auth/manager.go`).

---

## Interface: permissions

The interface checks permissions in few places; the server is the only enforcement for most actions.
Users see buttons that then fail.

### 10. ~~The lab view offers deploy and destroy to everyone~~ (fixed)

- **Status:** fixed — `permissions.spec.ts` › "another member's lab offers no deploy, destroy or node
  controls"
- **Where:** `components/dashboard-page/lab-view/lab-view-header/lab-view-header.tsx`, the node menu and
  the drawer in `lab-view/`
- **What happens:** members see Deploy, Redeploy, Destroy and the node actions on labs they didn't
  create. The server refuses with "Failed to deploy lab".
- **Fix:** the lab view works out whether the user is the lab's creator or an admin, and hides the lab's
  deploy, redeploy and destroy buttons and menu entries, and the nodes' start, stop and restart buttons
  and menu entries, from everyone else. Logs and terminals stay available to members.

### 11. ~~The Deploy buttons ignore "Anyone can deploy"~~ (fixed)

- **Status:** fixed — `permissions.spec.ts` › "without "Anyone can deploy" members get no Deploy buttons",
  "users who may not deploy anywhere get no New lab button", "the deploy dialog only offers topologies the
  user may deploy"
- **Where:** `components/editor-page/topology-editor/topology-editor.tsx` (toolbar),
  `explorer-tree-node.tsx` (row button). Only the explorer's context menu checks it.
- **What happens:** the editor's Deploy button and the topology row's Deploy button are shown in
  collections nobody may deploy. The dashboard's "New lab" lists all topologies, too.
- **Fix:** `CollectionStore.canDeployIn()` says whether the user may deploy in a collection (admins always,
  others with "Anyone can deploy"). The Deploy buttons of the editor and the explorer are hidden where it's
  false, the deploy dialog only lists deployable topologies, and "New lab" is hidden when there's nowhere
  to deploy. Unsafe topologies aren't covered; the server refuses them for users who aren't admins.
- **Also changed:** the lab schedule in the dock is only shown to admins.

### 12. ~~The graph editor ignores read-only topologies~~ (fixed)

- **Status:** fixed — `permissions.spec.ts` › "the graph of a read-only topology can not be edited", "a
  creator can not edit once the collection is read-only"
- **Where:** `components/editor-page/topology-editor/node-editor/node-editor.tsx`
- **What happens:** the code editor is read-only for users who may not edit the topology, but the graph
  lets them move, delete and add elements, and enables Save; saving then fails.
- **Fix:** `TopologyStore.canEdit()` decides like the server: admins, or the creator while anyone can edit
  the collection (before, a creator could edit in a read-only collection and saving failed). The code
  editor uses it, `TopologyManager` ignores graph edits of read-only topologies, the graph toolbar only
  keeps Select, Hand and Fit graph, and the read-only notice is shown over the graph too.
- **Not done yet:** the graph's context menus still show edit entries (they do nothing now), and nodes can
  still be dragged on screen (the move isn't kept).

### 13. ~~Members of a collection anyone can edit get no Add Topology button~~ (fixed)

- **Status:** fixed — `permissions.spec.ts` › "a collection anyone can edit has the Add Topology button
  for members", "a read-only collection has no Add Topology button for members"
- **Where:** `components/editor-page/topology-explorer/explorer-tree-node/explorer-tree-node.tsx`
  (`isCollectionWritable` is only computed for topology rows, so it's false for collections)
- **What happens:** the hover buttons of a collection are only shown to admins. Members have to use the
  right-click menu.
- **Fix:** `CollectionStore.canWriteIn()` (admins always, others with "Anyone can edit") decides the hover
  buttons of collection rows, the collection menu and the collections offered in the topology dialog.
- **Not done:** topology rows can still be dragged by their creator into collections the server won't
  accept, which ends in an error toast.

### 15. ~~Errors when creating a lab are titled "Failed to update lab"~~ (fixed)

- **Status:** fixed — `policy.spec.ts` › "the error for a refused lab is titled for creating, not
  updating", "a user deploying an unsafe topology is told why it was refused"
- **Where:** `components/common/lab-edit-dialog/lab-edit-dialog.tsx`
- **What happens:** e.g. "Failed to update lab — the topology contains unsafe features that the server
  rejected" for a new lab. Code 3005 isn't in `types/error-codes.ts`.
- **Fix:** the error is titled "Failed to create lab". Code 3005 is in `ErrorCodes` and shown as "This
  topology uses features that only admins can deploy.", and when several labs fail, the message adds the
  reason of the first failure.

---

## Interface: data

### 16. ~~Renaming or deleting a directory also hits directories with a similar name~~ (fixed)

- **Status:** fixed — `bind-files.spec.ts` › "renaming a directory leaves files with a similar name alone",
  "deleting a directory leaves files with a similar name alone"
- **Where:** `components/editor-page/topology-explorer/topology-explorer.tsx` (delete),
  `components/editor-page/bind-file-edit-directory-dialog/bind-file-directory-edit-dialog.tsx` (rename)
- **What happens:** both select files with `filePath.startsWith(directoryPath)`, without a trailing `/`.
  With `node1/startup.cfg` and `node10/startup.cfg`, renaming `node1` to `router1` also renames `node10/`
  to `router10/`, and deleting `node1` also deletes `node10/startup.cfg`.
- **Fix:** both use `isInDirectory()` (`lib/utils/utils.ts`), which matches the directory followed by `/`.
  Renaming replaces exactly the directory's prefix. The tests also cover a file next to the directory
  (`node1.cfg`).

### 17. ~~Archive upload overwrites another topology's file~~ (fixed)

- **Status:** fixed — `bind-files.spec.ts` › "overwriting a file leaves other topologies' files alone"
- **Where:** `lib/stores/topology-store.ts` (`uploadArchiveFiles` looks up existing files across all
  topologies)
- **What happens:** if another topology has a file with the same path, that file is overwritten and the
  target topology's file stays unchanged. Server bug 9 (bind file updates) lets this happen.
- **Fix:** `uploadArchiveFiles` looks the existing file up in the target topology only, and creates the
  file if it isn't there any more. Server bug 9 remains, so the server would still accept such a
  request.

### 18. ~~Moving a topology overwrites the open topology in the editor~~ (fixed)

- **Status:** fixed — `topologies.spec.ts` › "moving a topology leaves the open topology alone", "moving the
  open topology keeps its unsaved edits"
- **Where:** `components/editor-page/topology-explorer/topology-explorer.tsx` (after a drag and drop it calls
  `topologyStore.manager.editTopology(topologyBackup, …)`)
- **What happens:** dragging a topology into another collection replaces the open topology's definition
  with the moved topology's. Saving would then overwrite the open topology.
- **Fix:** the editor is only restored when the moved topology is the open one, and from the editor's own
  content, so unsaved edits are kept. Moving another topology doesn't touch the editor.

### 19. ~~Deleting the last link makes the topology unsaveable~~ (fixed)

- **Status:** fixed — `graph-editor.spec.ts` › "deleting the last link leaves a topology that can be
  saved"
- **Where:** the graph editor's delete (`lib/topology-manager.ts`)
- **What happens:** deleting the last link (or a node with the last link) leaves `links: []`. The
  containerlab schema requires at least one item, so the server rejects the save ("topology.links: minimum
  1 items required") and the editor then shows the file as invalid.
- **Fix:** `deleteLinkItems` (`lib/topology/containerlab/containerlab-definition.ts`) removes the `links`
  key when its last item is deleted. All link deletions go through it, including deleting nodes and
  "Clear graph".

### 20. ~~Links from a node to itself get the same interface on both ends~~ (fixed)

- **Status:** fixed — `graph-editor.spec.ts` › "a node can be connected to itself with two interfaces"
- **Where:** `lib/topology-manager.ts` (`connectNodes`), `lib/graph/interfaces.ts` (`nextInterface`)
- **What happened:** containerlab allows links between two interfaces of the same node. The editor picked
  the next free interface for both ends from the same topology, so a self-link got the same interface
  twice (`host1:eth2` ↔ `host1:eth2`), which containerlab can't deploy.
- **Fix:** `nextInterface` takes the interfaces that are already taken, and `connectNodes` passes the
  first end's interface for the second end of a self-link (`host1:eth2` ↔ `host1:eth3`). The broken check
  in `onNodeClick` that compared the ref object was removed: clicking the source node again creates the
  self-link on purpose.

### 21. "Delete group and nodes" keeps the nodes

- **Status:** verified — `graph-editor.spec.ts` › ""Delete group and nodes" deletes the nodes of the group"
- **Where:** `components/editor-page/topology-editor/node-editor/graph-context-menus.tsx` (label),
  `node-editor.tsx` (`onDeleteSelection` keeps the members)
- **What happens:** only the group box is deleted. Either the label or the behaviour is wrong; the
  selection bar's Delete has the same tooltip.

---

## Interface: other bugs

### 22. There's no way to delete a lab

- **Status:** verified — `labs.spec.ts` › "a scheduled lab can be deleted"
- **Where:** `components/dashboard-page/lab-grid/lab-entry/lab-entry.tsx` (card buttons commented out),
  `lab-view-header.tsx` (the "Delete Lab" variant is never enabled)
- **What happens:** labs pile up; only the API can delete them.

### 23. The dashboard search does nothing

- **Status:** verified — `dashboard.spec.ts` › "the search shows only matching labs"
- **Where:** `components/dashboard-page/lab-explorer/lab-explorer.tsx` sets `labStore.searchQuery`, but
  `lab-grid.tsx` (`filteredLabs`) and `lib/stores/lab-store.ts` (`getParams`) ignore it.

### 24. Labs that start later and run indefinitely are shown as Inactive

- **Status:** verified — `dashboard.spec.ts` › "a lab without an end time that starts later is shown as
  scheduled"
- **Where:** `lib/stores/lab-store.ts` (a lab is only Scheduled if it has an end time)

### 25. Collapsing the Scheduled group isn't remembered

- **Status:** verified — `dashboard.spec.ts` › "a collapsed Scheduled group stays collapsed after a reload"
- **Where:** `components/dashboard-page/lab-grid/lab-grid.tsx` (the stored groups are validated with
  `oneOf('Active', 'Inactive', 'Archived')`, so a set with "Scheduled" is invalid and everything resets)

### 26. Labs that never ran show the current time as "Deployed"

- **Status:** verified — `lab-view.spec.ts` › "a lab that never ran shows no deployment time"
- **Where:** `components/dashboard-page/lab-view/lab-view-panel-properties/lab-view-panel-properties.tsx`.
  The "(Recovered)" tooltip there doesn't work either (wrong target class, typo in `data-pr-my`).

### 27. The date pickers use the 12-hour clock without AM or PM

- **Status:** verified — `labs.spec.ts` › "the date pickers show times in the 24-hour format"
- **Where:** `components/common/lab-edit-dialog/lab-edit-dialog.tsx` (`YYYY-MM-DD hh:mm:ss`)
- **What happens:** 15:00 is shown as 03:00:00.
- **Fix idea:** `HH:mm:ss`.

### 28. "Download YAML" in the topology menu does nothing

- **Status:** verified — `topologies.spec.ts` › "Download YAML in the topology menu downloads the topology"
- **Where:** `components/editor-page/topology-explorer/topology-explorer.tsx` (empty handler). The toolbar's
  Download button works.

### 29. Directories with a dash in their name don't open

- **Status:** verified — `bind-files.spec.ts` › "a directory with a dash in its name opens on click"
- **Where:** `components/editor-page/topology-explorer/topology-explorer.tsx` (directories are recognised by
  `key.split('-').length === 6`, so `core-1/` counts as a file)

### 30. Bind files get no unsaved marker

- **Status:** verified — `bind-files.spec.ts` › "an edited file is marked as unsaved"
- **Where:** `components/editor-page/topology-editor/topology-editor.tsx`
- **What happens:** topologies show `name*` while they have unsaved changes; bind files don't, although Save
  is enabled.

### 31. Smaller interface issues, from the code

- **Shortcuts only work with Ctrl:** the editor's Ctrl+S, Ctrl+Z and Ctrl+Y check `event.ctrlKey` only
  (`monaco-wrapper.tsx`), so Cmd doesn't work on macOS, unlike the graph shortcuts. They also check for a
  lowercase key, so they don't work with Caps Lock on.
- **The dashboard doesn't update lab states over time:** the state is worked out when the labs are
  loaded, so a lab whose start has passed keeps showing "Scheduled" until something reloads the labs
  (seen in the tests).
- **Stabilizing saves the layout before the animation ends** (`node-editor.tsx`, `onSaveGraph()` right
  after starting `cose-bilkent` with `animate: true`), so the saved positions may not be the shown ones.
- **Upload errors are ignored:** the archive upload doesn't report failed files
  (`editor-page.tsx`, `void uploadArchiveFiles`).
- **"Copy SSH command" ignores `ssh.enabled`** and uses the logs' condition for being disabled; the
  drawer's "Copy capture command" ignores `capture.enabled` (`lab-view.tsx`, `lab-view-drawer.tsx`).
- **The setup screen's "New topology" uses the first collection**, even if the user can't write to it
  (`editor-setup.tsx`).
- **Crashes when a lab's collection is missing:** `lab-entry.tsx`, `lab-grid.tsx` and
  `lab-view-panel-properties.tsx` use `!` on the collection lookup.
- **Login can fail silently:** `loginNative` returns true even when the refresh after it fails
  (`data-binder.ts`).
- **Logout may not reach the server:** the page reloads right after sending the request
  (`data-binder.ts`), which can cancel it.
- **The loading screen** checks `Connecting` while it's only shown during `Loading`, and never shows again
  once hidden (`app.tsx`).
- **`StatusMessageStore.clear()`** leaves `lookup` and the counts behind.
- **Accessibility:** every "…" button in the explorer is labelled "Edit Collection", even on topologies and
  files; the terminal tab's close button and the selection bar's arrange button have no name; the file
  switch's options have no `role="option"`.
- **The credits show a hard-coded version** "v1.0.0" (`credits-dialog.tsx`).
- **Undeclared dependencies:** `moment` (`calendar-dialog.tsx`) and `lodash` (`lab-edit-dialog.tsx`) only
  come in through other packages.

---

## Fixed since the previous list

Connecting nodes in the graph editor; deleting a collection now deletes its topologies; downloading bind
files; the archive dialog closes after uploading; nodes without positions are spread out; links between
different kinds get the right interface names; the build workflow's `.nvmrc`; lab links open any lab; the
node menu right after deploying; the "Add Group" button covering rows (removed); the server's
`filesystem` config section.

## Not bugs, but worth knowing

- Members may open terminals on other members' labs, but only the lab's creator (and admins) may deploy,
  destroy or start and stop its nodes.
- Saving a change made in the graph writes the whole YAML back, in block style.
- Sync URL: "Fetch" is only enabled once the topology has a saved sync URL.
- "Clear graph" removes all nodes without asking (it can be undone).
- The topology dialog fills in the collection a moment after it opens.
