# Changelog

## Unreleased

### General Changes

- The topology editor now opens topologies and bind files in tabs. A single click previews a file, a double click or a change keeps its tab open. The graph of each tab keeps its zoom and position, also when switching to the dashboard and back.
- Unsaved changes in the editor are kept in the browser, also over a reload, so opening another file no longer asks to discard them. Only closing a tab with unsaved changes asks first.

## Antimony v0.2.0 - Light Mode and Lab Improvements

This update brings a light mode to the interface, a [separate management network](https://antimony.run/docs/deployment/configuration/#deploymentmgmt) for every lab and a long list of fixes for labs on Docker and on Kubernetes with [clabernetes](https://antimony.run/docs/deployment/clabernetes/). The server and the interface now also live in [one repository](https://github.com/antimony-team/antimony), together with the [documentation](https://antimony.run/docs/).

### General Changes

- Added a light mode to the interface, along with a button to switch between the two ([#3](https://github.com/antimony-team/antimony/issues/3)).
- Every lab now gets its own [management network](https://antimony.run/docs/deployment/configuration/#deploymentmgmt), so labs deployed at the same time no longer get clashing addresses ([#8](https://github.com/antimony-team/antimony/issues/8)).
- Lab names now use the topology name as prefix by default, so labs of different topologies can have the same name ([#4](https://github.com/antimony-team/antimony/issues/4)).
- Labs can now be filtered by topology in the [lab grid](https://antimony.run/docs/manual/dashboard/#the-lab-grid).
- [Terminals](https://antimony.run/docs/manual/lab-view/#terminals) can now be opened in full screen and in a separate tab ([#4](https://github.com/antimony-team/antimony/issues/4)).
- Nodes now keep their links when they are restarted.
- Failed labs can now be deployed again, and failed and inactive labs can be deleted from the [lab view](https://antimony.run/docs/manual/lab-view/) ([#4](https://github.com/antimony-team/antimony/issues/4)).
- Added a context menu to the labs in the [lab grid](https://antimony.run/docs/manual/dashboard/#the-lab-grid).
- Typing anywhere in the dashboard now starts a search.
- Dates are now shown in the user's locale throughout the interface.
- Labs with config and bind files can now be deployed on [clabernetes](https://antimony.run/docs/deployment/clabernetes/), which gets them as a config map ([#5](https://github.com/antimony-team/antimony/issues/5)).
- Upgraded clabernetes to version [0.10.1](https://github.com/srl-labs/clabernetes/releases/tag/v0.10.1).
- Added the `sshNamespace` field to the [kinds config](https://antimony.run/docs/deployment/configuration/#node-kinds-kindsconfyml) to set the network namespace a node runs SSH in, so nodes such as Cisco XRd become ready ([#7](https://github.com/antimony-team/antimony/issues/7)).
- Added a [comparison with the Containerlab apps](https://antimony.run/docs/getting-started/why-antimony/) to the README and the documentation.

### Security

- Secret environment variables are no longer visible to subprocesses.
- Socket namespaces of a lab are now only accessible to its participants.
- Node statistics are now only sent to users with access to the node's lab.
- Lab control buttons are now hidden from users without access to the lab.
- Archive uploads can no longer overwrite another topology's files.
- Bind file updates and deletions now require the correct topology.
- Lab, collection and instance names are now sanitised properly, and validated in the interface as well.

### Bug Fixes

- Failed labs are now destroyed right away and no longer show an uptime ([#8](https://github.com/antimony-team/antimony/issues/8)).
- Labs that never ran no longer show as deployed, and labs are no longer flagged as inactive by mistake.
- Labs can no longer end before they start.
- Terminals can no longer be opened on nodes that aren't ready, and the server denies such requests as well.
- Fixed several race conditions when opening, resizing and closing terminals.
- Fixed node restarts on clabernetes.
- Fixed [packet capture on clabernetes](https://antimony.run/docs/deployment/clabernetes/#traffic-capture-on-clabernetes).
- Resizing a clabernetes terminal while it closes no longer crashes the server.
- Containerlab's event listener now restarts after a failure.
- Nodes whose containers were removed no longer stay running.
- Docker log streaming no longer drops log lines longer than 64 KB.
- Docker container statistics are now always read from the correct cgroup, also on systemd nodes.
- Nodes linked to themselves now choose a free interface.
- Removing the last link now also removes the links key from the topology.
- Fixed a topology sometimes not being saved, so that a lab deployed right after showed the wrong topology ([#6](https://github.com/antimony-team/antimony/issues/6)).
- Moving a topology no longer overwrites the currently open one.
- Renaming a bind file directory now only renames its children.
- Fixed the download YAML button for topologies.
- Fixed keybinds in the YAML editor.
- Deleting a group with nodes inside now works properly.
- Fixed the SSH command not being escaped properly.
- The credits window now shows the correct version.
- Fixed the styling of alerts and popups.

### QoL Improvements

- Merged the server and the interface into [one repository](https://github.com/antimony-team/antimony).
- The save button in the editor toolbar is now always visible, also on narrow screens ([#4](https://github.com/antimony-team/antimony/issues/4)).
- Improved accessibility throughout the interface.
- [Unsafe topologies](https://antimony.run/docs/deployment/topology-policy/) now show a clear message explaining why they can't be deployed.
- Read-only topologies are now shown as such in the editor.
- Non-admins can now add topologies to any collection they can write to.
- IP addresses are now shown consistently, without the prefix length.

## Antimony v0.1.0 - First Release

- First public release of Antimony. See the [release](https://github.com/antimony-team/antimony/releases/tag/v0.1.0).
