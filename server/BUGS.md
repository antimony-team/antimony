# Bugs found while writing the provider e2e tests

Bugs are fixed one by one as we go through the list. Fixed ones move to the "Fixed" section.

Each entry is either **suspected** (found by reading the code, not reproduced yet) or **confirmed**
(reproduced by a test, which is named in the entry).

## Suspected

### 5. Containerlab log streams are never closed

- `deployment/containerlab.go` `StreamContainerLogs`

The log stream is read by `go streamOutput(out, onLog)`, but `out` is never closed, unlike the
clabernetes provider, which closes it with `defer stream.Close()`. Every node start or restart opens
another stream, so the connection to Docker is only released when the lab's context ends.

### 6. A failing interactive command is detected with a fixed 20 ms wait

- `deployment/containerlab.go` `ExecInteractive`

After attaching, the provider sleeps 20 ms and checks whether the exec has already exited with a
non-zero code. A command that takes longer to fail (a slow node, a loaded host) is handed out as a
working shell session.

Not reproduced in phase 1: `ExecInteractive/fails_for_a_command_that_doesn't_exist` passes locally,
where a missing command fails within the 20 ms. It stays suspected for slower hosts.

### 8. Dialing a containerlab node picks a random network

- `deployment/containerlab.go` `DialNode`

The provider takes the first network with an address from `NetworkSettings.Networks`, which is a map.
A node attached to more than one network gets a random one of them on each call.

## Confirmed

None left, see "Fixed".

## Fixed

### 3. Container stats assume Docker's systemd cgroup driver

- `deployment/sampler_docker.go` `readTarget`

The cgroup path is fixed to `/sys/fs/cgroup/system.slice/docker-<id>.scope`. With the `cgroupfs` driver
(`/sys/fs/cgroup/docker/<id>`) or rootless Docker the files don't exist, so every stats read reports
the node as not running.

Not reproducible here: the local machine and the CI runners use the systemd driver, where
`ReadNodeStats` passes in the e2e tests.

**Fixed** (it stays unreproduced on a real host, since every host here uses the systemd driver): the sampler no
longer builds the path. It reads the container's cgroup v2 path from `/proc/<pid>/cgroup` (the `0::` line) when it
resolves the node, joins it with the cgroup root, and caches it with the PID. That works for every cgroup driver
and parent, rootless Docker and Podman. A path starting with `/..` means the server runs in a cgroup namespace of
its own; the sampler then says so instead of reporting the node as not running. `/proc` and the cgroup root are
fields of the sampler now, so the new `TestDockerSampler_*` tests can build both trees in a temp directory:
systemd and cgroupfs drivers, a custom parent, rootless Docker, Podman, a hybrid hierarchy, a foreign namespace, an
exited process and a removed container. Still to run at the end: the stats e2e steps on containerlab.

### 12. A clabernetes shell for a command that doesn't exist opens anyway

- `deployment/clabernetes.go` `ExecInteractive`

The provider starts the exec stream in a goroutine and hands the session out right away, so a command
that can't start isn't reported. Containerlab returns an error ("failed to start"), which the shell
service shows to the user. With clabernetes, the shell opens and its output just ends.

Confirmed on a c9s 0.9.0 kind cluster.

Test: `TestProviderE2E/ExecInteractive/fails_for_a_command_that_doesn't_exist`, marked with `knownBug`
for clabernetes.

**Fixed:** `ExecInteractive` now waits until the command has started before it hands out the session
(`openInteractiveSession`): until the first output arrives, the stream fails, or one second passes for a command
that prints nothing. A command that can't start returns "command [...] failed to start: ...", like containerlab,
and the first output is kept for the first read. New unit tests `TestOpenInteractiveSession_*` run against fake
streams. The `knownBug` marker in the e2e test is removed, and with it the last use of `knownBug`. Still to run
at the end: `ExecInteractive` on clabernetes.

### 13. A shell whose output ends with an error is never removed

- `runtime/shell/service.go` `runShell`, `OpenShellCommand`

Found while looking at #12. When a shell's output ended with an error other than EOF, for example a dropped
connection to the node, `runShell` sent the error to the client and stopped, but only the EOF path removed and
closed the shell. A failed shell kept counting against the user's shell limit and kept its namespace until the
inactivity timeout (30 minutes by default). Also, `OpenShellCommand` started `runShell` before adding the shell to
`openShells`, so a shell that ended right away could be added after it was removed.

**Fixed:** after reporting the error, `runShell` removes and closes the shell, unless it was closed already, which
is when the error comes from closing it. `OpenShellCommand` registers the shell before starting `runShell`.
Test: `TestShellData_AFailedShellIsReportedAndRemoved`, which fails without the fix.

### 11. Clabernetes node operations don't report an unknown node like containerlab does

- `deployment/clabernetes.go` `StopNode`, `StartNode` (through `setIgnoreReconcile`) and `RestartNode`

For a node that doesn't exist, containerlab returns `utils.ErrNodeNotFound`. Clabernetes returns the raw
Kubernetes "not found" error from patching the `Node` for stop and start. Restart deletes the pods by label,
which finds nothing and succeeds silently. The instance service checks the node against its own lab first,
so this only matters when the node's resources disappeared from the cluster.

Confirmed on a c9s 0.9.0 kind cluster: stop and start fail with `nodes.c9s.run "missing" not found`.

Test: `TestProviderE2E/NodeLifecycle/an_unknown_node`, marked with `knownBug` for clabernetes.

**Fixed:** a new `nodeError` helper turns Kubernetes' "not found" into `utils.ErrNodeNotFound` for the `Node` patch
and the Deployment scale, so stop and start report an unknown node like containerlab. `RestartNode` gets the node's
Deployment first and returns `ErrNodeNotFound` without deleting anything if it doesn't exist. Restarting a stopped
node still does nothing, since its Deployment has no pod to delete. The service only restarts running nodes, so
that is left as it is. `TestStopNode_FailsForAnUnknownNode` expects `ErrNodeNotFound` now, and there are new unit
tests for start and restart. The `knownBug` marker in the e2e test is removed. Still to run at the end:
`NodeLifecycle/an_unknown_node` on clabernetes.

### 4. Containerlab and clabernetes report node addresses differently

- `deployment/containerlab.go` `parseInspectContainer`
- `deployment/clabernetes.go` `podToInspectContainer`

Containerlab's inspect output carries the prefix length (`172.20.20.4/24`), which the provider passes
through. Clabernetes reports the bare pod IP (`10.244.0.7`). The same field means different things
depending on the provider.

Confirmed by the e2e runs: containerlab reports `172.20.20.6/24` and `3fff:172:20:20::6/64`, clabernetes
reports `10.244.0.12` and no IPv6 address. The `Inspect` e2e test logs both.

**Fixed:** the containerlab provider drops the prefix length (`netip.ParsePrefix` → `.Addr()`), so both providers
and the dummy report bare addresses. A value that isn't a prefix is kept as it is, and `N/A` still becomes empty.
New unit tests `TestClabToInspectContainer_ReportsBareAddresses` and `…_KeepsAddressesItCannotParse`. The provider
e2e `Inspect` step now checks that every address is a valid bare address on both providers. Still to run at the
end: that step on both providers.

### 10. Packet capture is never possible on clabernetes 0.9.0

- `deployment/clabernetes.go` `packetCaptureCommand`

The provider only allows a capture if the pod has a `clabwire` container in `pod.Spec.Containers`. c9s
0.9.0 renders `clabwire` as a native sidecar: an init container with `restartPolicy: Always`
(`renderHelpers` in `internal/directpod/renderer.go` of the c9s module). So it is in
`pod.Spec.InitContainers`, and `OpenCapture` returns `ErrCaptureNotSupported` for every node. The unit
test fixture in `clabernetes_test.go` adds `clabwire` to `Containers`, which is why the unit tests pass.

Confirmed on a c9s 0.9.0 kind cluster: `OpenCapture` on `eth1`, a link interface, fails with "packet
capture is not supported by this provider".

Test: `TestProviderE2E/OpenCapture`, marked with `knownBug` for clabernetes.

**Fixed:** `packetCaptureCommand` looks for `clabwire` in the init containers as well as the containers. The rest
of the capture already matched c9s 0.9.0: the node UID annotation is set on every node pod, and the command is the
one c9s generates itself (`internal/directpod/renderer.go`). The test fixture now renders the sidecar like c9s
0.9.0, as an init container with `restartPolicy: Always`, and a new test keeps the regular-container case working.
The `knownBug` markers in the provider and server e2e tests are removed. Still to run at the end: both capture e2e
tests on clabernetes.

### 9. Containerlab reports a missing lab or node container as a generic failure

- `deployment/containerlab.go` `InspectLab` (and `InspectNode`, which calls it)

Containerlab 0.78 builds `inspect -t <topology>` from the topology file and exits with status 1 as soon as
one node has no container:

```
Failed to list containers based on topology: could not get container for node clab-e2e-nope-a: Node: clab-e2e-nope-a. containers not found.
```

The provider expects the lab to be missing from the JSON output instead, so it never returns
`utils.ErrLabNotRunning`. The unit test `TestContainerlabInspectLab_ReportsAMissingLabAsNotRunning` uses a
fake `containerlab` that answers the way the provider expects, which the real one doesn't.

It goes further than the error type: if a single node's container of a running lab is gone (removed by
hand, or never created), inspecting the lab fails. Then `InspectNode` fails for every node of that lab, so
`fetchNode` ignores all their events, and the inspect after a deployment marks the whole lab as failed.
Confirmed by hand: deploy a two-node lab, `docker rm -f` one node's container, and
`containerlab inspect -t` fails with the error above.

Tests: `TestProviderE2E/Inspect/a_lab_that_isn't_deployed_is_not_running` and `TestProviderE2E/Destroy`,
both marked with `knownBug` for containerlab.

**Fixed:** `InspectLab` now picks the lab from `InspectLabs` (`containerlab inspect --all`), which finds containers by
their labels. A lab without containers is reported as `ErrLabNotRunning`, and a node without a container is just
missing, so `InspectNode` returns `ErrNodeNotFound` for it and the other nodes stay usable. The unit tests expect
the `--all` call, and the `knownBug` markers in the e2e test are removed. New e2e step
`TestProviderE2E/MissingNodeContainer` (containerlab only) removes a node's container with Docker and checks the rest
of the lab. Still to run at the end: the containerlab e2e tests.

### 2. Resizing a clabernetes shell while it closes can crash the server

- `deployment/clabernetes.go` `kubernetesExecSession.Close` closes the size channel
- `deployment/clabernetes.go` `sizeQueue.push` sends on it
- `runtime/shell/service.go` `ResizeShellCommand` gets the shell, releases the lock, then calls `Resize`

If the shell is closed between the lookup and the `Resize` call, `push` sends on a closed channel, which
panics even inside a `select` with a `default`. A second `Close` also panics (closing a closed channel).

Confirmed on a c9s 0.9.0 kind cluster and with a throwaway unit test on `kubernetesExecSession`: `Resize` after `Close` panics with "send on
closed channel", and a second `Close` panics with "close of closed channel". The panic happens in the
socket handler's goroutine, so it takes the whole server down.

Test: `TestProviderE2E/ExecInteractive/resizing_or_closing_a_closed_session_is_harmless`, marked with
`knownBug` for clabernetes (it passes for containerlab).

**Fixed:** `sizeQueue` never closes the channel it sends on anymore. A `done` channel, closed once, ends the queue.
`kubernetesExecSession.Close` only acts on its first call, and `Resize` after `Close` returns `io.ErrClosedPipe`.
The `ShellExecSession` interface now says that `Close` may be called more than once and must not panic. The
shell service still closes a session from more than one goroutine; with the provider fixed, that's harmless.
New unit tests: `TestKubernetesExecSession_ResizingOrClosingAClosedSessionIsHarmless` and
`TestKubernetesExecSession_ResizingWhileItClosesIsHarmless`. The `knownBug` marker in the e2e test is removed.
Still to run at the end: the e2e tests on clabernetes.

### 1. Node events are matched to labs by node name only

- `runtime/instance/service.go` `registerProviderEventListener`
- `deployment/containerlab.go` `RegisterListener` (passes only the `clab-node-name` label)
- `deployment/clabernetes.go` `RegisterListener` (passes only the node label or deployment name)

The provider reports a changed node by its name, without the lab. The instance service then picks the
first lab in its map that has a node with that name. If two running labs both have a node called
`host1`, an event from one lab can be applied to the other. That lab sees no state change, and the
lab the event came from never refreshes its node. Containers of labs that Antimony doesn't manage
(for example the desktop app's labs on the same Docker host) also trigger lookups.

Confirmed with containerlab: three labs with the same node names, `host2` of the last one stopped and started
three times behind Antimony's back. The lab missed 3 of its 6 node changes in two runs out of two; its node
stayed "running" while the container was stopped. Which lab gets an event depends on map order, so the
number of misses varies from run to run.

Test: `TestProviderE2E_EventsReachTheRightLabWhenNodeNamesRepeat` (in `src/test`). Because the bug is random,
it only logs how many changes were missed instead of failing.

**Fixed:** the listener callback is now `onUpdate(instanceName, nodeName)`. Containerlab takes the lab from the
container's `containerlab` label, clabernetes from the `c9s.run/topologyOwner` label, and the instance service
only looks the node up in that lab. Events of labs Antimony doesn't run are dropped. The e2e test now asserts
that no change is missed. New harness tests: `TestProviderEvent_EventIsRoutedToTheOwningInstance` (rewritten,
it fails with the old lookup) and `TestProviderEvent_EventOfALabAntimonyDoesNotRunIsIgnored`. Still to run at
the end: the e2e tests on both providers.

## Not bugs

### 7. Clabernetes stop and start assume the deployment is named after the node

- `deployment/clabernetes.go` `scaleNode`, `setIgnoreReconcile` and the deployment informer in
  `RegisterListener`

The provider patches the deployment and the c9s `Node` by the node's name, and reports a scaled
deployment by its own name. If c9s names its resources `<topology>-<node>`, stopping a node fails with
"not found", and the scale events report a name no lab has.

Ruled out by the c9s 0.9.0 source: `compiler/render.go` names each `Node` after the node itself, and
`internal/directpod/renderer.go` names the node's Deployment after the `Node`. The
`NodeLifecycle` e2e test stops and starts a node on a real cluster in CI.
