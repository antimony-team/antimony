import React, {MouseEvent, useEffect, useMemo, useRef, useState} from 'react';

import classNames from 'classnames';
import cytoscape from 'cytoscape';
import {observer} from 'mobx-react-lite';

import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';
import {Splitter, SplitterPanel} from 'primereact/splitter';

import TopologyGraph, {
  TopologyGraphRef,
} from '@sb/components/common/topology-graph/topology-graph';
import LabDialogDrawer from '@sb/components/dashboard-page/lab-view/lab-view-drawer/lab-view-drawer';
import LabViewHeader from '@sb/components/dashboard-page/lab-view/lab-view-header/lab-view-header';
import LabViewPanelProperties from '@sb/components/dashboard-page/lab-view/lab-view-panel-properties/lab-view-panel-properties';
import LogDialog, {
  ANTIMONY_LOG,
  LogDialogState,
} from '@sb/components/dashboard-page/log-dialog/log-dialog';
import TerminalDialog, {
  TerminalDialogState,
} from '@sb/components/dashboard-page/terminal-dialog/terminal-dialog';
import {generateGraph} from '@sb/lib/graph/cytoscape-utils';
import {
  useCollectionStore,
  useDeviceStore,
  useLabStore,
  useServerConfig,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {useDialogState} from '@sb/lib/utils/hooks';
import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {getSSHCommand} from '@sb/lib/utils/utils';
import {If} from '@sb/types/control';
import {
  InstanceNode,
  InstanceNodeState,
  InstanceState,
  Lab,
} from '@sb/types/domain/lab';

import './lab-view.sass';

interface LabDialogProps {
  lab: Lab | null;
  onClose: () => void;
  onDestroyLabRequest: (lab: Lab) => void;
}

const ALL_STATE_CLASSES = [
  'ready',
  'running',
  'starting',
  'stopping',
  'stopped',
  'settling',
];

const PULSING = ['starting', 'stopping', 'settling'];

const LabView = observer((props: LabDialogProps) => {
  const graphRef = useRef<TopologyGraphRef>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const contextMenuRef = useRef<ContextMenu | null>(null);

  // The node that is currently selected and active in the drawer
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // The node that is currently targeted by the context menu
  const [contextTargetNode, setContextTargetNode] = useState<string | null>(
    null,
  );

  const logDialogState = useDialogState<LogDialogState>();
  const terminalDialogState = useDialogState<TerminalDialogState>();

  const serverConfig = useServerConfig();
  const deviceStore = useDeviceStore();
  const labStore = useLabStore();
  const collectionStore = useCollectionStore();
  const statusMessageStore = useStatusMessages();

  useEffect(() => {
    if (!cyRef.current || !props.lab?.instance) return;

    const nodes = props.lab.instance.nodes;

    cyRef.current.batch(() => {
      if (!cyRef.current) return;

      for (const node of nodes) {
        const el = cyRef.current.getElementById(node.name);
        if (el.nonempty()) applyNodeState(el, node);
      }
    });
  }, [props.lab?.instance?.nodes, props.lab?.state]);

  const elements = useMemo(() => {
    if (!props.lab) return [];

    return generateGraph(props.lab.topologyDefinition, deviceStore);
  }, [props.lab?.id]);

  const labCollection = useMemo(() => {
    if (!props.lab) return null;

    return collectionStore.lookup.get(props.lab.collectionId)!;
  }, [props.lab]);

  function onGraphContext(event: cytoscape.EventObject) {
    if (!contextMenuRef.current) return;

    const mouseEvent = event.originalEvent as unknown as MouseEvent;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    if (event.target === event.cy) {
      setContextTargetNode(null);
      contextMenuRef.current.show(mouseEvent);
      return;
    }

    // Ignore node and group context event if lab is not currently started
    if (!props.lab?.instance) return;

    // Ignore context events on group nodes
    if (event.target.hasClass('drawn-shape')) {
      return;
    }

    if (event.target.hasClass('topology-node')) {
      const nodeId = event.target.id();
      setContextTargetNode(nodeId);
      contextMenuRef.current.show(mouseEvent);
    }
  }

  function onNodeClick(event: cytoscape.EventObject) {
    const target = event.target;

    if (target.hasClass && target.hasClass('topology-node')) {
      setSelectedNode(target.id());
    } else {
      setSelectedNode(null);
    }
  }

  function onNodeStart(nodeId: string | null) {
    if (
      !nodeId ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(nodeId)
    ) {
      return;
    }

    void labStore.startNode(props.lab, nodeId);
  }

  function onNodeStop(nodeId: string | null) {
    if (
      !nodeId ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(nodeId)
    ) {
      return;
    }

    void labStore.stopNode(props.lab, nodeId);
  }

  function onNodeRestart(nodeId: string | null) {
    if (
      !nodeId ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(nodeId)
    ) {
      return;
    }

    void labStore.restartNode(props.lab, nodeId);
  }

  function openLabLogs() {
    logDialogState.openWith({
      lab: props.lab!,
      source: ANTIMONY_LOG,
    });
  }

  function onOpenLogs(nodeId: string | null) {
    const instance = props.lab!.instance!;

    logDialogState.openWith({
      lab: props.lab!,
      source: nodeId ? instance.nodeMap.get(nodeId)!.name : ANTIMONY_LOG,
    });
  }

  function onOpenTerminal(nodeId: string | null) {
    if (
      !nodeId ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(nodeId)
    ) {
      return;
    }

    terminalDialogState.openWith({
      lab: props.lab!,
      node: nodeId,
    });
  }

  const graphContextMenuModel = [
    {
      label: 'Deploy lab',
      icon: 'pi pi-play',
      disabled: !canDeployLab(),
      command: () => labStore.deployLab(props.lab!),
    },
    {
      label: 'Redeploy lab',
      icon:
        props.lab?.state === InstanceState.Deploying
          ? 'pi pi-sync pi-spin'
          : 'pi pi-sync',
      disabled: !canRedeployLab(),
      command: () => labStore.deployLab(props.lab!),
    },
    {
      label: 'Destroy lab',
      icon: 'pi pi-power-off',
      disabled: !canDestroylab(),
      command: () => props.onDestroyLabRequest(props.lab!),
    },
    {
      separator: true,
    },
    {
      label: 'View logs',
      icon: (
        <span className="material-symbols-outlined">quick_reference_all</span>
      ),
      disabled: !canOpenLabLogs(),
      command: () => onOpenLogs(null),
    },
    {
      separator: true,
    },
    {
      label: 'Fit graph',
      icon: <span className="material-symbols-outlined">fit_screen</span>,
      command: onFitGraph,
    },
  ];

  const networkContextMenuItems: MenuItem[] | undefined = useMemo(() => {
    // If the selected node is null, the graph itself is selected
    if (contextTargetNode === null) {
      return graphContextMenuModel;
    }

    const instance = props.lab?.instance;

    if (!cyRef.current || !props.lab || !instance) {
      return undefined;
    }

    // Return an empty context menu if selected node is a group node
    if (
      cyRef.current.getElementById(contextTargetNode).hasClass('drawn-shape')
    ) {
      return;
    }

    const node = instance.nodeMap.get(contextTargetNode);
    const nodeActionChecker = new NodeActionChecker(instance, node);

    const entries: MenuItem[] = [
      {
        label: 'Start node',
        icon: 'pi pi-power-off',
        command: () => onNodeStart(contextTargetNode),
        disabled: !nodeActionChecker.canStart,
      },
      {
        label: 'Stop node',
        icon: 'pi pi-power-off',
        command: () => onNodeStop(contextTargetNode),
        disabled: !nodeActionChecker.canStop,
      },
      {
        label: 'Restart node',
        icon: 'pi pi-sync',
        command: () => onNodeRestart(contextTargetNode),
        disabled: !nodeActionChecker.canRestart,
      },
      {
        separator: true,
      },
      {
        label: 'Open terminal',
        icon: <span className="material-symbols-outlined">terminal</span>,
        command: () => onOpenTerminal(contextTargetNode),
        disabled: !nodeActionChecker.canOpenTerminal,
      },
      {
        label: 'Show logs',
        icon: (
          <span className="material-symbols-outlined">quick_reference_all</span>
        ),
        disabled: !nodeActionChecker.canShowLogs,
        command: () => onOpenLogs(contextTargetNode),
      },
      {
        label: 'Copy SSH command',
        icon: <span className="material-symbols-outlined">terminal</span>,
        disabled: !nodeActionChecker.canShowLogs,
        command: () => copyCaptureToClipboard(node),
      },
    ];

    if (serverConfig.capture.enabled && node) {
      if (node.interfaces.length > 0) {
        entries.push({separator: true});
      }

      for (const iface of node.interfaces) {
        entries.push({
          label: 'Copy capture for ' + iface.name,
          icon: 'pi pi-copy',
          command: () => copyCaptureToClipboard(node, iface.name),
        });
      }
    }

    return entries;
  }, [contextTargetNode, props.lab]);

  function copyCaptureToClipboard(
    node?: InstanceNode,
    captureInterface?: string,
  ) {
    if (!node || !props.lab || !labCollection) return;

    const cmd = getSSHCommand(
      labCollection.name,
      props.lab.name,
      node.name,
      window.location.hostname,
      serverConfig.ssh.port,
      captureInterface,
    );
    void navigator.clipboard.writeText(cmd);

    statusMessageStore.success('Command copied to clipboard!');
  }

  function applyNodeState(
    cyNode: cytoscape.NodeSingular,
    node: InstanceNode,
  ): void {
    const cls = getNodeStateClass(node);
    if (cyNode.hasClass(cls)) return;
    if (cls === 'ready' && cyNode.hasClass('settling')) return; // switch already scheduled

    const wasPulsing = PULSING.some(c => cyNode.hasClass(c));
    cyNode.removeClass(ALL_STATE_CLASSES.join(' '));

    // Pulsing → ready: let the current pulse finish, then switch to green.
    if (cls === 'ready' && wasPulsing) {
      cyNode.addClass('settling');
      setTimeout(() => {
        if (!cyNode.hasClass('settling')) return; // state changed again meanwhile

        cyNode.removeClass('settling').addClass('ready');
        cyNode.removeStyle('background-image-opacity');
      }, pulseRemainingRef.current(cyNode));
      return;
    }

    cyNode.addClass(cls);

    if (cls === 'starting' || cls === 'stopping') {
      // Entering a pulse: start on this node's own clock.
      if (!wasPulsing) cyNode.scratch('pulseStart', performance.now());
      return;
    }

    // Settled state reached without pulsing to completion:
    // hand the status dot back to the stylesheet.
    if (wasPulsing) {
      cyNode.removeStyle('background-image-opacity');
    }
  }

  function startStatePing(cy: cytoscape.Core) {
    const period = 1400;
    const minOpacity = 0.3;
    let frame = 0;

    // ms until the current pulse is back at full opacity
    pulseRemainingRef.current = (n: cytoscape.NodeSingular) => {
      const s = n.scratch('pulseStart');
      return s === undefined ? 0 : period - ((performance.now() - s) % period);
    };

    const tick = (now: number) => {
      const active = cy.nodes(
        '.topology-node.starting, .topology-node.stopping, .topology-node.settling',
      );
      if (active.length > 0) {
        cy.batch(() => {
          active.forEach(n => {
            const s = n.scratch('pulseStart') ?? now;
            const t = ((now - s) % period) / period;
            const wave = (1 + Math.cos(t * 2 * Math.PI)) / 2;
            const dotOpacity = minOpacity + (1 - minOpacity) * wave;
            n.style({'background-image-opacity': `1 ${dotOpacity}`});
          });
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }

  const pulseRemainingRef = useRef<(n: cytoscape.NodeSingular) => number>(
    () => 0,
  );

  useEffect(() => {
    if (!props.lab) return;

    if (logDialogState.isOpen && !props.lab.instance) {
      logDialogState.close();
    }
  }, [props.lab]);

  function onFitGraph() {
    graphRef.current?.fit(true);
  }

  function canOpenLabLogs() {
    return (
      Boolean(props.lab?.instance) ||
      props.lab?.state === InstanceState.Deploying ||
      props.lab?.state === InstanceState.Failed
    );
  }

  function canDeployLab() {
    return (
      !props.lab?.instance &&
      props.lab?.state !== InstanceState.Deploying &&
      props.lab?.state !== InstanceState.Stopping
    );
  }

  function canRedeployLab() {
    return (
      Boolean(props.lab?.instance) && props.lab?.state === InstanceState.Running
    );
  }

  function canDestroylab() {
    return (
      Boolean(props.lab?.instance) &&
      (props.lab!.state === InstanceState.Running ||
        props.lab!.state === InstanceState.Deploying)
    );
  }

  return (
    <>
      <div
        className={classNames('sb-island sb-lab-view', {
          open: props.lab,
        })}
      >
        <If condition={props.lab}>
          <LabViewHeader
            lab={props.lab!}
            onClose={props.onClose}
            onOpenLabLogs={openLabLogs}
            onDestroyLabRequest={props.onDestroyLabRequest}
            canDeployLab={canDeployLab}
            canRedeployLab={canRedeployLab}
            canDestroyLab={canDestroylab}
            canOpenLabLogs={canOpenLabLogs}
          />
        </If>
        <div className="sb-lab-view-content">
          <div className="sb-lab-view-drawer-container">
            <Splitter
              className="h-full"
              pt={{
                gutter: {
                  style: {
                    opacity:
                      selectedNode && props.lab?.instance?.nodes.length
                        ? '1'
                        : '0',
                  },
                },
              }}
            >
              <SplitterPanel className="sb-lab-view-drawer-decoy"></SplitterPanel>
              <SplitterPanel
                size={30}
                minSize={30}
                className={classNames('sb-lab-view-drawer', {
                  closed: !selectedNode || !props.lab?.instance?.nodes.length,
                })}
              >
                <LabDialogDrawer
                  lab={props.lab}
                  nodeName={selectedNode}
                  onOpenTerminal={onOpenTerminal}
                  onOpenLogs={onOpenLogs}
                  onNodeStart={onNodeStart}
                  onNodeStop={onNodeStop}
                  onNodeRestart={onNodeRestart}
                />
              </SplitterPanel>
            </Splitter>
          </div>
          <div className="topology-graph-container">
            <If condition={props.lab}>
              <LabViewPanelProperties lab={props.lab!} />
            </If>
            <TopologyGraph
              ref={graphRef}
              elements={elements}
              fitKey={props.lab?.id ?? null}
              isLocked={true}
              events={{tap: onNodeClick, cxttap: onGraphContext}}
              onInstance={cy => {
                cyRef.current = cy;
                return startStatePing(cy);
              }}
            />
          </div>
        </div>
      </div>
      <ContextMenu model={networkContextMenuItems} ref={contextMenuRef} />
      <LogDialog dialogState={logDialogState} />
      <TerminalDialog dialogState={terminalDialogState} />
    </>
  );
});

function getNodeStateClass(node: InstanceNode) {
  switch (node.state) {
    case InstanceNodeState.Stopped:
      return 'stopped';
    case InstanceNodeState.Stopping:
      return 'stopping';
    case InstanceNodeState.Starting:
      return 'starting';
    case InstanceNodeState.Running:
      return node.isReady ? 'ready' : 'starting';
  }
}

export default LabView;
