# Known bugs

Found while writing the end-to-end tests (October 2026). Each entry says how it was confirmed:

- **verified**: reproduced by an e2e test. The test asserts the correct behaviour and starts with
  `knownBug('…')`, so it's expected to fail and the suite stays green. Once the bug is fixed, Playwright
  reports the test as unexpectedly passing; then remove the `knownBug()` line. `E2E_KNOWN_BUGS=1 yarn e2e`
  runs these tests as normal tests, to see them fail.
- **from the code**: found by reading the code, not covered by a test.

Paths are relative to `antimony-server/src/`.

---

## Server

### 1. Every signed-in user hears about every lab

- **Status:** verified — `server.spec.ts` › "users don't hear about labs of collections they aren't in"
- **Where:** `main.go` (`/status-messages`), `runtime/instance/service.go` (`/lab-updates`),
  `runtime/instance/monitor.go` (`/stats/<id>`, no access check), `runtime/shell/service.go`
  (`/shell-control`)
- **What happens:** a user without any collection receives the status messages (lab names, internal log
  lines with lab IDs) and lab updates of all labs. From the code, `/stats/*` and `/shell-control` (shell IDs,
  labs and nodes of all users) are open to everyone as well.
- **Fix idea:** send these only to admins and members of the lab's collection.

### 2. The topology policy is only checked when a lab is created

- **Status:** verified — `server.spec.ts` › "a lab created from a safe topology can not be deployed once it
  is unsafe"
- **Where:** `domain/lab/service.go` (only `POST /labs` checks the policy), `runtime/instance/service.go`
  (socket deploy), the scheduler
- **What happens:** a user creates a lab while the topology is safe. Once the topology contains unsafe
  features (changed by its creator or an admin), the user can still deploy the lab with the Deploy button,
  and the scheduler starts it as well.
- **Fix idea:** check the policy whenever a lab is deployed by a user who isn't an admin.

### 3. Bind files and topology deletion ignore "Anyone can edit"

- **Status:** verified — `permissions.spec.ts` › "a creator can not change bind files once the collection is
  read-only"
- **Where:** `domain/topology/service.go` (bind file create, update, delete and topology delete check only
  the creator)
- **What happens:** editing a topology needs the collection to be writable, but its creator can still add,
  change and delete its bind files, and delete it, after the collection is made read-only or they lost
  their membership. Bind files can change the policy findings of a topology.
- **Fix idea:** check publicWrite and membership like the topology update does.

### 4. Destroying a lab that isn't running removes it from the schedule

- **Status:** verified — `server.spec.ts` › "destroying a lab that is not running leaves its schedule alone"
- **Where:** `runtime/instance/service.go` (`DestroyLabCommand` publishes `lab.deleted` before checking that
  the lab runs)
- **What happens:** the command fails with 5012 "lab not running", but the lab silently drops out of the
  schedule and never starts. The dashboard still shows it as Scheduled.

### 5. Pages of `GET /labs` are short for users who aren't admins

- **Status:** verified — `server.spec.ts` › "a page of labs is full for users who are not admins"
- **Where:** `domain/lab/repository.go` (limit and offset in SQL), `domain/lab/service.go` (membership filter
  afterwards)
- **What happens:** `?limit=1` returns no lab at all when the first lab in the database belongs to another
  collection. The interface doesn't page, so it's only visible to API users.

### 6. Labs can end before they start

- **Status:** verified — `server.spec.ts` › "a lab can not end before it starts"
- **Where:** `domain/lab/service.go` (create and update)
- **What happens:** `endTime` before `startTime` is accepted.

### 7. Lab and collection names are barely checked

- **Status:** verified — `server.spec.ts` › "collection and lab names are checked on the server"
- **Where:** `domain/lab/entity.go`, `domain/collection/entity.go` (`required` accepts `""`), no name
  validation for collections
- **What happens:** a lab can be called `""`. A collection can be called `a/b`, which breaks the SSH
  syntax `<collection>/<lab>/<node>`. Names with `'`, `"`, `$`, `` ` ``, `;` or `|`, or starting with `-`,
  are accepted too, but OpenSSH 10 refuses them as usernames ("remote username contains invalid
  characters"), so their nodes can't be reached over SSH. The interface quotes them in the copied
  commands, but the server should reject them when labs and collections are created.

### 8. Smaller server issues, from the code

- **Bind file updates don't check the topology in the URL:** `PATCH /topologies/A/files/<file of B>`
  changes B's file (admins only). `transport/http/topology/handler.go` ignores `:topologyId`.
- **Access and refresh tokens are interchangeable, and logout revokes nothing:** any valid token with an
  `id` works as either (`auth/manager.go`). The 30-day refresh token works as a Bearer access token, and
  an access token works as a refresh token, so a leaked access token can be renewed forever. Logout only
  deletes the cookies (`transport/http/user/handler.go`). Planned as a separate rework (typed tokens and
  revocable sessions).
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

## Not bugs, but worth knowing

- Members may open terminals on other members' labs, but only the lab's creator (and admins) may deploy,
  destroy or start and stop its nodes.
- Saving a change made in the graph writes the whole YAML back, in block style.
- Sync URL: "Fetch" is only enabled once the topology has a saved sync URL.
- "Clear graph" removes all nodes without asking (it can be undone).
- The topology dialog fills in the collection a moment after it opens.
