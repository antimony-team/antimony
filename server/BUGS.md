# Known bugs

Bugs of the server that are known but not fixed yet. Fixed bugs are removed from this list, their history is in git.

## Known issues

Open bugs that wait on something outside Antimony.

### 26. Clabernetes can't act on nodes whose names Kubernetes can't carry

- `deployment/clabernetes.go`

Found while checking the Kubernetes naming rules for the frontend's name validation (F7). c9s 0.9.0 names a node's
`Node`, Deployment and pods with a sanitized name (`compiler/render.go`, `SanitizeName`): lowercase, invalid
characters replaced by `-`, a prefix for a leading digit, a hash for long names. So `R1` becomes `r1` and `srl_1`
becomes `srl-1`, and none of the objects carry the original name. The provider looks nodes up by the topology's
name and reports the cluster's, so on clabernetes such nodes can't be inspected, stopped, started, restarted, dialled
or given a shell, and their events match no node. Topologies with only valid names (lowercase letters, digits, `-`)
aren't affected; containerlab isn't affected at all.

**Status:** waiting on c9s. A request to keep the original node name on a node's objects (a label or annotation)
has been filed upstream. A workaround in the provider (mapping through c9s's `SanitizeName` and the `Topology`
definition) was written and reverted, to avoid re-implementing c9s's naming in Antimony.
