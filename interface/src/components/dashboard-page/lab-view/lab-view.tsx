// import LabDetailsOverlay from '@sb/components/dashboard-page/lab-dialog/lab-details-overlay/lab-details-overlay';
import LogDialog, {
  ANTIMONY_LOG,
  LogDialogState,
} from '@sb/components/dashboard-page/log-dialog/log-dialog';

import TerminalDialog, {
  TerminalDialogState,
} from '@sb/components/dashboard-page/terminal-dialog/terminal-dialog';
import {topologyStyle} from '@sb/lib/cytoscape-styles';
import {
  useCollectionStore,
  useDeviceStore,
  useLabStore,
  useServerConfig,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {useDialogState} from '@sb/lib/utils/hooks';
import {
  drawGraphGrid,
  generateGraph,
  getFitPadding,
  getInterfaceCaptureCommand,
  getNodeStateClass,
} from '@sb/lib/utils/utils';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {InstanceNode, InstanceState, Lab} from '@sb/types/domain/lab';

import cytoscape from 'cytoscape';
import {ExpandLines} from 'iconoir-react';
import {observer} from 'mobx-react-lite';
import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';
import React, {MouseEvent, useEffect, useMemo, useRef, useState} from 'react';
import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {Button} from 'primereact/button';
import StateIndicator from '@sb/components/dashboard-page/state-indicator/state-indicator';
import classNames from 'classnames';

import './lab-view.sass';
import {Splitter, SplitterPanel} from 'primereact/splitter';
import LabDialogDrawer from '@sb/components/dashboard-page/lab-view/lab-view-drawer/lab-view-drawer';
import LabViewPanelProperties from '@sb/components/dashboard-page/lab-view/lab-view-panel-properties/lab-view-panel-properties';
import CytoscapeComponent from 'react-cytoscapejs';

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

const READY_UNDERLAY = {
  'underlay-color': '#80e163',
  'underlay-padding': 6,
  'underlay-opacity': 0.5,
};

const PULSING = ['starting', 'stopping', 'settling'];

const LabView = observer((props: LabDialogProps) => {
  const cyRef = useRef<cytoscape.Core | null>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // const [hostsHidden, setHostsHidden] = useState(false);
  const contextMenuRef = useRef<ContextMenu | null>(null);

  // The node that is currently selected and active in the drawer
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // The node that is currently targeted by the context menu
  const [contextTargetNode, setContextTargetNode] = useState<string | null>(
    null,
  );

  const logDialogState = useDialogState<LogDialogState>();
  const terminalDialogState = useDialogState<TerminalDialogState>();

  const [isCyReady, setIsCyReady] = useState<boolean>(false);

  const serverConfig = useServerConfig();
  const collectionStore = useCollectionStore();
  const deviceStore = useDeviceStore();
  const labStore = useLabStore();
  const topologyStore = useTopologyStore();
  const statusMessageStore = useStatusMessages();

  const cyHasInitialized = useRef(false);

  const groupName = useMemo(() => {
    if (!props.lab) return;

    const collectionId = props.lab.collectionId;
    if (!collectionStore.lookup.has(collectionId)) return;
    return collectionStore.lookup.get(collectionId)!.name;
  }, [props.lab, collectionStore.lookup]);

  useEffect(() => {
    // Reset selected node when lab changes
    // setSelectedNode(null);
  }, [props.lab]);

  useEffect(() => {
    if (!isCyReady || !cyRef.current) return;
    return startStatePing(cyRef.current);
  }, [isCyReady]);

  useEffect(() => {
    if (isCyReady && cyRef.current && props.lab && !cyHasInitialized.current) {
      initCytoscape(cyRef.current);
      cyHasInitialized.current = true;
    }
  }, [isCyReady, props.lab]);

  const elements = useMemo(() => {
    if (!props.lab) return [];

    return generateGraph(
      props.lab.topologyDefinition,
      deviceStore,
      topologyStore.manager,
      null,
      false,
    );
  }, [props.lab?.id]);

  function onGraphContext(event: cytoscape.EventObject) {
    if (!contextMenuRef.current || !cyRef.current) return;

    const mouseEvent = event.originalEvent as unknown as MouseEvent;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    if (event.target === cyRef.current) {
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
      source: nodeId ? instance.nodeMap.get(nodeId)!.containerId : ANTIMONY_LOG,
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

  function openWebSsh(nodeId: string | null) {
    // if (
    //   !nodeId ||
    //   !props.lab?.instance ||
    //   !props.lab.instance.nodeMap.has(nodeId)
    // ) {
    //   return;
    // }
    //
    // const instance = props.lab.instance;
    // const webSshUrl = instance.nodeMap.get(selectedNode)!.webSSH;
    //
    // window.open(webSshUrl, '_blank');
  }

  const graphContextMenuModel = [
    {
      label: 'Deploy Lab',
      icon: 'pi pi-play',
      disabled: !canDeployLab(),
      command: () => labStore.deployLab(props.lab!),
    },
    {
      label: 'Redeploy Lab',
      icon:
        props.lab?.state === InstanceState.Deploying
          ? 'pi pi-sync pi-spin'
          : 'pi pi-sync',
      disabled: !canRedeployLab(),
      command: () => labStore.deployLab(props.lab!),
    },
    {
      label: 'Destroy Lab',
      icon: 'pi pi-power-off',
      disabled: !canDestroylab(),
      command: () => props.onDestroyLabRequest(props.lab!),
    },
    {
      separator: true,
    },
    {
      label: 'View Logs',
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
      label: 'Fit Graph',
      icon: (
        <ExpandLines
          style={{transform: 'rotate(90deg)'}}
          width={24}
          height={24}
        />
      ),
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
        label: 'Start Node',
        icon: 'pi pi-power-off',
        command: () => onNodeStart(contextTargetNode),
        disabled: !nodeActionChecker.canStart,
      },
      {
        label: 'Stop Node',
        icon: 'pi pi-power-off',
        command: () => onNodeStop(contextTargetNode),
        disabled: !nodeActionChecker.canStop,
      },
      {
        label: 'Restart Node',
        icon: 'pi pi-sync',
        command: () => onNodeRestart(contextTargetNode),
        disabled: !nodeActionChecker.canRestart,
      },
      {
        separator: true,
      },
      {
        label: 'Open Terminal',
        icon: <span className="material-symbols-outlined">terminal</span>,
        command: () => onOpenTerminal(contextTargetNode),
        disabled: !nodeActionChecker.canOpenTerminal,
      },
      {
        label: 'Show Logs',
        icon: (
          <span className="material-symbols-outlined">quick_reference_all</span>
        ),
        disabled: !nodeActionChecker.canShowLogs,
        command: () => onOpenLogs(contextTargetNode),
      },
    ];

    if (serverConfig.capture.enabled && node) {
      if (node.interfaces.length > 0) {
        entries.push({separator: true});
      }

      for (const iface of node.interfaces) {
        entries.push({
          label: 'Copy Capture for ' + iface.name,
          icon: 'pi pi-copy',
          command: () => copyCaptureToClipboard(node.containerId, iface.name),
        });
      }
    }

    if (node?.webSSH) {
      entries.push({
        label: 'Web SSH',
        icon: 'pi pi-external-link',
        command: () => openWebSsh(contextTargetNode),
      });
    }

    return entries;
  }, [contextTargetNode, props.lab]);

  function copyCaptureToClipboard(containerId: string, ifName: string) {
    const cmd = getInterfaceCaptureCommand(
      containerId,
      ifName,
      window.location.hostname,
      serverConfig.capture.port,
    );
    void navigator.clipboard.writeText(cmd);

    statusMessageStore.success('Capture command copied to clipboard!');
  }

  function initCytoscape(cy: cytoscape.Core) {
    cy.minZoom(0.3);
    cy.maxZoom(10);

    cy.on('tap', onNodeClick);
    cy.on('cxttap', onGraphContext);
    cy.on('render', drawGridOverlay);
    // cy.on('zoom', onZoom);
    // cy.on('mousedown', onMouseDown);
    cy.style().fromJson(topologyStyle).update();

    cy.nodes().lock();

    cy.animate({
      fit: {
        padding: getFitPadding(cy),
        eles: cy.elements(),
      },
      duration: 50,
    });
  }

  function applyNodeState(
    cyNode: cytoscape.NodeSingular,
    node: InstanceNode,
  ): void {
    const cls = getNodeStateClass(node);
    if (cyNode.hasClass(cls)) return;
    if (cls === 'ready' && cyNode.hasClass('settling')) return; // bloom already scheduled

    const wasPulsing = PULSING.some(c => cyNode.hasClass(c));
    cyNode.removeClass(ALL_STATE_CLASSES.join(' '));

    // Pulsing → ready: let the current pulse finish, then grow the green ring.
    if (cls === 'ready' && wasPulsing) {
      cyNode.addClass('settling');
      setTimeout(() => {
        if (!cyNode.hasClass('settling')) return; // state changed again meanwhile

        cyNode.removeClass('settling').addClass('ready');
        cyNode.style({
          'underlay-color': READY_UNDERLAY['underlay-color'],
          'underlay-padding': 0,
          'underlay-opacity': READY_UNDERLAY['underlay-opacity'],
        });
        cyNode
          .animation({
            style: {'underlay-padding': READY_UNDERLAY['underlay-padding']},
            duration: 350,
            easing: 'ease-out',
          })
          .play()
          .promise('completed')
          .then(() =>
            cyNode.removeStyle(
              'underlay-color underlay-padding underlay-opacity',
            ),
          );
      }, pulseRemainingRef.current(cyNode));
      return;
    }

    cyNode.addClass(cls);

    if (cls === 'starting' || cls === 'stopping') {
      // Entering a pulse: start from radius 0 on this node's own clock.
      if (!wasPulsing) cyNode.scratch('pulseStart', performance.now());
      return;
    }

    // Settled state reached without a bloom (stopped, or ready from a cold start):
    // hand the underlay back to the stylesheet.
    if (wasPulsing) {
      cyNode.removeStyle('underlay-color underlay-padding underlay-opacity');
    }
  }

  useEffect(() => {
    const cy = cyRef.current;
    if (!isCyReady || !cy) return;

    const nodes = props.lab?.instance?.nodes ?? [];
    const labState = props.lab?.state;

    cy.batch(() => {
      if (nodes.length > 0) {
        for (const node of nodes) {
          const el = cy.getElementById(node.name);
          if (el.nonempty()) applyNodeState(el, node);
        }
        return;
      }

      // No per-node information yet: derive from the lab's own state.
      const all = cy.nodes('.topology-node');
      if (
        labState === InstanceState.Deploying ||
        labState === InstanceState.Stopping
      ) {
        const cls =
          labState === InstanceState.Deploying ? 'starting' : 'stopping';
        all.forEach(el => {
          if (el.hasClass(cls)) return;
          el.removeClass(ALL_STATE_CLASSES.join(' ')).addClass(cls);
          el.scratch('pulseStart', performance.now());
        });
      } else {
        all
          .removeClass(ALL_STATE_CLASSES.join(' '))
          .removeStyle('underlay-color underlay-padding underlay-opacity');
      }
    });
  }, [isCyReady, props.lab?.instance?.nodes, props.lab?.state]);

  function startStatePing(cy: cytoscape.Core) {
    const period = 1100;
    const maxPad = 15;
    let frame = 0;

    // ms until the current pulse reaches full expansion / zero opacity
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
            n.style({
              'underlay-padding': 2 + t * maxPad,
              'underlay-opacity': 0.6 * (1 - t),
            });
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

  function drawGridOverlay(event: cytoscape.EventObject) {
    if (!gridCanvasRef.current || !containerRef.current || !event.cy) return;

    drawGraphGrid(containerRef.current, gridCanvasRef.current, event.cy);
  }

  useEffect(() => {
    if (!props.lab) return;

    if (logDialogState.isOpen) {
      if (!props.lab.instance) {
        logDialogState.close();
      } /* else {
        logDialogState.openWith({
          lab: props.lab,
          source: ANTIMONY_LOG,
        });
      }*/
    }
  }, [props.lab]);

  function onFitGraph() {
    if (!cyRef.current) return;

    cyRef.current.animate({
      fit: {
        padding: getFitPadding(cyRef.current),
        eles: cyRef.current.elements(),
      },
      duration: 200,
    });
  }

  function canOpenLabLogs() {
    return (
      props.lab?.instance ||
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
    return props.lab?.instance && props.lab?.state === InstanceState.Running;
  }

  function canDestroylab() {
    return (
      props.lab?.instance &&
      (props.lab!.state === InstanceState.Running ||
        props.lab!.state === InstanceState.Deploying)
    );
  }

  return (
    <>
      <div
        className={classNames('sb-card sb-lab-view', {
          open: props.lab,
        })}
      >
        <div className="sb-lab-view-header">
          <Button
            text
            icon="pi pi-arrow-left"
            size="large"
            onClick={() => props.onClose()}
            tooltip="Back"
            tooltipOptions={{position: 'bottom', showDelay: 500}}
            aria-label="Download"
          />
          <If condition={props.lab}>
            <StateIndicator lab={props.lab!} showText={false} />
          </If>
          <span className="sb-lab-dialog-title-name">{groupName + ' / '}</span>
          <span>{props.lab?.name}</span>
          <div className="flex-grow-1" />
          <div className="sb-lab-view-header-buttons">
            <Button
              outlined
              icon={
                <span className="material-symbols-outlined">
                  quick_reference_all
                </span>
              }
              label="View Logs"
              aria-label="View Logs"
              onClick={openLabLogs}
              disabled={!canOpenLabLogs()}
            />
            <Choose>
              <When condition={canDeployLab()}>
                <Button
                  outlined
                  icon="pi pi-play"
                  severity="success"
                  onClick={() => labStore.deployLab(props.lab!)}
                />
              </When>
              <Otherwise>
                <Button
                  outlined
                  icon={
                    props.lab?.state === InstanceState.Deploying
                      ? 'pi pi-sync pi-spin'
                      : 'pi pi-sync'
                  }
                  severity="warning"
                  aria-label="Redeploy Lab"
                  onClick={() => labStore.deployLab(props.lab!)}
                  disabled={!canRedeployLab()}
                  tooltipOptions={{
                    showOnDisabled: true,
                  }}
                />
                <Button
                  outlined
                  icon="pi pi-power-off"
                  aria-label={
                    props.lab!.state === InstanceState.Scheduled
                      ? 'Delete Lab'
                      : 'Destroy Lab'
                  }
                  severity="danger"
                  onClick={() => props.onDestroyLabRequest(props.lab!)}
                  disabled={!canDestroylab()}
                />
              </Otherwise>
            </Choose>
          </div>
        </div>
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
                  className: 'sb-lab-view-drawer-gutter',
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
          <div className="topology-graph-container" ref={containerRef}>
            <If condition={props.lab}>
              <LabViewPanelProperties lab={props.lab!} />
              <canvas ref={gridCanvasRef} className="grid-canvas" />
            </If>
            <CytoscapeComponent
              className="cytoscape-container"
              elements={elements}
              cy={(cy: cytoscape.Core) => {
                cyRef.current = cy;
                setIsCyReady(true);
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

export default LabView;
