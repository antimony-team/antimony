// import LabDetailsOverlay from '@sb/components/dashboard-page/lab-dialog/lab-details-overlay/lab-details-overlay';
import LogDialog, {
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
  getInterfaceCaptureCommand,
} from '@sb/lib/utils/utils';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {InstanceState, Lab} from '@sb/types/domain/lab';

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

const LabView: React.FC<LabDialogProps> = observer((props: LabDialogProps) => {
  const cyRef = useRef<cytoscape.Core | null>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // const [hostsHidden, setHostsHidden] = useState(false);
  const nodeContextMenuRef = useRef<ContextMenu | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const logDialogState = useDialogState<LogDialogState>();
  const terminalDialogState = useDialogState<TerminalDialogState>();

  const [isCyReady, setIsCyReady] = useState<boolean>(false);

  const serverConfig = useServerConfig();
  const collectionStore = useCollectionStore();
  const deviceStore = useDeviceStore();
  const labStore = useLabStore();
  const topologyStore = useTopologyStore();
  const statusMessageStore = useStatusMessages();

  const groupName = useMemo(() => {
    if (!props.lab) return;

    const collectionId = props.lab.collectionId;
    if (!collectionStore.lookup.has(collectionId)) return;
    return collectionStore.lookup.get(collectionId)!.name;
  }, [props.lab, collectionStore.lookup]);

  useEffect(() => {
    // Reset selected node when lab changes
    setSelectedNode(null);
  }, [props.lab]);

  useEffect(() => {
    if (isCyReady && cyRef.current && props.lab) {
      initCytoscape(cyRef.current);
    }
  }, [isCyReady, props.lab]);

  const elements = useMemo(() => {
    if (!props.lab) return [];

    return generateGraph(
      props.lab.topologyDefinition,
      deviceStore,
      topologyStore.manager,
      props.lab.instance,
      false,
    );
  }, [props.lab?.topologyDefinition, props.lab?.instance]);

  function onGraphContext(event: cytoscape.EventObject) {
    if (!nodeContextMenuRef.current || !cyRef.current) return;

    const mouseEvent = event.originalEvent as unknown as MouseEvent;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    if (event.target === cyRef.current) {
      setSelectedNode(null);
      nodeContextMenuRef.current.show(mouseEvent);
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
      setSelectedNode(nodeId);
      nodeContextMenuRef.current.show(mouseEvent);
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

  function onNodeStart() {
    if (
      !selectedNode ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(selectedNode)
    ) {
      return;
    }

    void labStore.startNode(props.lab, selectedNode);
  }

  function onNodeStop() {
    if (
      !selectedNode ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(selectedNode)
    ) {
      return;
    }

    void labStore.stopNode(props.lab, selectedNode);
  }

  function onNodeRestart() {
    if (
      !selectedNode ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(selectedNode)
    ) {
      return;
    }

    void labStore.restartNode(props.lab, selectedNode);
  }

  function onOpenLogs() {
    // closeDetails();

    const instance = props.lab!.instance!;

    logDialogState.openWith({
      lab: props.lab!,
      source: selectedNode
        ? instance.nodeMap.get(selectedNode)?.containerId
        : undefined,
    });
  }

  function onOpenTerminal() {
    // closeDetails();

    if (
      !selectedNode ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(selectedNode)
    ) {
      return;
    }

    terminalDialogState.openWith({
      lab: props.lab!,
      node: selectedNode,
    });
  }

  function openWebSsh() {
    if (
      !selectedNode ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.has(selectedNode)
    ) {
      return;
    }

    const instance = props.lab.instance;
    const webSshUrl = instance.nodeMap.get(selectedNode)!.webSSH;

    window.open(webSshUrl, '_blank');
  }

  const graphContextMenuModel = [
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
    if (selectedNode === null) {
      return graphContextMenuModel;
    }

    const instance = props.lab?.instance;

    if (!cyRef.current || !props.lab || !instance) {
      return undefined;
    }

    // Return an empty context menu if selected node is a group node
    if (cyRef.current.getElementById(selectedNode).hasClass('drawn-shape')) {
      return;
    }

    const node = instance.nodeMap.get(selectedNode);
    const nodeActionChecker = new NodeActionChecker(instance, node);

    const entries: MenuItem[] = [
      {
        label: 'Start Node',
        icon: 'pi pi-power-off',
        command: onNodeStart,
        disabled: !nodeActionChecker.canStart,
      },
      {
        label: 'Stop Node',
        icon: 'pi pi-power-off',
        command: onNodeStop,
        disabled: !nodeActionChecker.canStop,
      },
      {
        label: 'Restart Node',
        icon: 'pi pi-sync',
        command: onNodeRestart,
        disabled: !nodeActionChecker.canRestart,
      },
      {
        separator: true,
      },
      {
        label: 'Open Terminal',
        icon: <span className="material-symbols-outlined">terminal</span>,
        command: onOpenTerminal,
        disabled: !nodeActionChecker.canOpenTerminal,
      },
      {
        label: 'Show Logs',
        icon: (
          <span className="material-symbols-outlined">quick_reference_all</span>
        ),
        disabled: !nodeActionChecker.canShowLogs,
        command: onOpenLogs,
      },
    ];

    if (serverConfig.capture.enabled && node) {
      if (node.interfaces.length > 0) {
        entries.push({separator: true});
      }

      for (const iface of node.interfaces) {
        entries.push({
          label: 'Open Capture for ' + iface.name,
          icon: 'pi pi-eye',
          command: () => copyCaptureToClipboard(node.containerName, iface.name),
        });
      }
    }

    if (node?.webSSH) {
      entries.push({
        label: 'Web SSH',
        icon: 'pi pi-external-link',
        command: openWebSsh,
      });
    }

    return entries;
  }, [selectedNode, props.lab]);

  function copyCaptureToClipboard(containerName: string, ifName: string) {
    const cmd = getInterfaceCaptureCommand(
      containerName,
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
    cy.fit(undefined, 130);
  }

  function drawGridOverlay(event: cytoscape.EventObject) {
    if (!gridCanvasRef.current || !containerRef.current || !event.cy) return;

    drawGraphGrid(containerRef.current, gridCanvasRef.current, event.cy);
  }

  useEffect(() => {
    if (!props.lab) return;

    if (logDialogState.isOpen) {
      if (!props.lab.instance) {
        logDialogState.close();
      } else {
        logDialogState.openWith({
          lab: props.lab,
        });
      }
    }
  }, [props.lab]);

  function onFitGraph() {
    if (!cyRef.current) return;

    cyRef.current.fit(undefined, 120);
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
            <Choose>
              <When condition={!props.lab?.instance}>
                <Button
                  outlined
                  icon="pi pi-play"
                  label="Deploy Now"
                  aria-label="Deploy Now"
                  severity="success"
                  onClick={() => labStore.deployLab(props.lab!)}
                />
              </When>
              <Otherwise>
                <Button
                  outlined
                  icon={
                    <span className="material-symbols-outlined">
                      quick_reference_all
                    </span>
                  }
                  label="Show Logs"
                  aria-label="Show Logs"
                  onClick={onOpenLogs}
                />
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
                  disabled={props.lab?.state === InstanceState.Deploying}
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
                  disabled={props.lab!.state === InstanceState.Inactive}
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
      <ContextMenu model={networkContextMenuItems} ref={nodeContextMenuRef} />
      <LogDialog dialogState={logDialogState} />
      <TerminalDialog dialogState={terminalDialogState} />
    </>
  );
});

export default LabView;
