import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import LabDetailsOverlay from '@sb/components/dashboard-page/lab-dialog/lab-details-overlay/lab-details-overlay';
import LabDialogPanelAdmin from '@sb/components/dashboard-page/lab-dialog/lab-dialog-panel-admin/lab-dialog-panel-admin';
import LabDialogPanelProperties from '@sb/components/dashboard-page/lab-dialog/lab-dialog-panel-properties/lab-dialog-panel-properties';
import LogDialog, {
  LogDialogState,
} from '@sb/components/dashboard-page/log-dialog/log-dialog';
import StateIndicator from '@sb/components/dashboard-page/state-indicator/state-indicator';

import './lab-dialog.sass';
import TerminalDialog, {
  TerminalDialogState,
} from '@sb/components/dashboard-page/terminal-dialog/terminal-dialog';
import {topologyStyle} from '@sb/lib/cytoscape-styles';
import {
  useCollectionStore,
  useDeviceStore,
  useLabStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogState, useDialogState} from '@sb/lib/utils/hooks';
import {drawGraphGrid, generateGraph} from '@sb/lib/utils/utils';
import {If} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';

import cytoscape, {NodeSingular} from 'cytoscape';
import {ExpandLines} from 'iconoir-react';
import {observer} from 'mobx-react-lite';
import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';
import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import {TooltipRefProps} from 'react-tooltip';

interface LabDialogProps {
  dialogState: DialogState<Lab>;
  onDestroyLabRequest: (lab: Lab) => void;
}

const LabDialog: React.FC<LabDialogProps> = observer(
  (props: LabDialogProps) => {
    const cyRef = useRef<cytoscape.Core | null>(null);
    const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [hostsHidden, setHostsHidden] = useState(false);
    const nodeContextMenuRef = useRef<ContextMenu | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const logDialogState = useDialogState<LogDialogState>();
    const terminalDialogState = useDialogState<TerminalDialogState>();

    const [isCyReady, setIsCyReady] = useState<boolean>(false);
    const collectionStore = useCollectionStore();
    const deviceStore = useDeviceStore();
    const labStore = useLabStore();
    const topologyStore = useTopologyStore();

    const nodeDetailOverlay = useRef<TooltipRefProps>(null);

    const groupName = useMemo(() => {
      if (!props.dialogState.state) return;

      const collectionId = props.dialogState.state.collectionId;
      if (!collectionStore.lookup.has(collectionId)) return;

      return collectionStore.lookup.get(collectionId)!.name;
    }, [props.dialogState.state, collectionStore.lookup]);

    useEffect(() => {
      if (isCyReady && cyRef.current) {
        initCytoscape(cyRef.current);
      }
    }, [isCyReady]);

    const graphInitiallyFitted = useRef(false);

    /**
     * We have update graph elements manually instead of using the reactive
     * elements prop provided by the React Cytoscape library because the library
     * dynamically adds and removes elements when the element prop is updated.
     *
     * This makes it so, if a parent is deleted in the graph, its children
     * are also deleted. This is unwanted behavior.
     */
    const updateGraph = useCallback(() => {
      if (!cyRef.current || !props.dialogState.state) return;

      cyRef.current!.elements().remove();

      const elements = generateGraph(
        props.dialogState.state.topologyDefinition,
        deviceStore,
        topologyStore.manager,
        props.dialogState.state.instance,
        hostsHidden
      );

      for (const element of elements) {
        cyRef.current!.add(element);
      }

      if (!graphInitiallyFitted.current) {
        graphInitiallyFitted.current = true;
        onFitGraph();
      }

      cyRef.current!.nodes().lock();
    }, [props.dialogState.state, hostsHidden]);

    const onOpen = useCallback(() => {
      if (!cyRef.current) return;

      initCytoscape(cyRef.current);
      updateGraph();
    }, [updateGraph, props.dialogState.state]);

    useEffect(() => {
      updateGraph();
    }, [props.dialogState.state, hostsHidden]);

    function onGraphContext(event: cytoscape.EventObject) {
      if (!nodeContextMenuRef.current || !cyRef.current) return;

      closeDetails();

      const mouseEvent = event.originalEvent as unknown as MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();

      if (event.target === cyRef.current) {
        setSelectedNode(null);
        nodeContextMenuRef.current.show(mouseEvent);
        return;
      }

      // Ignore context events on group nodes
      if (event.target.hasClass('drawn-shape')) {
        return;
      }

      if (event.target.isNode) {
        const nodeId = event.target.id();
        setSelectedNode(nodeId);
        nodeContextMenuRef.current.show(mouseEvent);
      }
    }

    function onNodeClick(event: cytoscape.EventObject) {
      const target = event.target;

      if (target.isNode && target.isNode()) {
        setSelectedNode(target.id());

        const node = props.dialogState.state?.instance?.nodeMap.get(
          target.id()
        );

        if (node && nodeDetailOverlay.current) {
          if (nodeDetailOverlay.current.isOpen) {
            nodeDetailOverlay.current.close();
          } else {
            const position = (target as NodeSingular).renderedPosition();
            const canvasPosition =
              gridCanvasRef.current!.getBoundingClientRect();

            const nodeWidth = 30;
            const offset = nodeWidth * cyRef.current!.zoom();

            nodeDetailOverlay.current!.open({
              position: {
                x: position.x + canvasPosition!.x + offset,
                y: position.y + canvasPosition!.y,
              },
            });
          }
        }
      } else {
        closeDetails();
      }
    }

    function onZoom() {
      closeDetails();
    }

    function onNodeStart() {
      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      void labStore.startNode(props.dialogState.state, selectedNode);
    }

    function onNodeStop() {
      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      void labStore.stopNode(props.dialogState.state, selectedNode);
    }

    function onNodeRestart() {
      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      void labStore.restartNode(props.dialogState.state, selectedNode);
    }

    function onOpenLogs() {
      closeDetails();

      const instance = props.dialogState.state!.instance!;

      logDialogState.openWith({
        lab: props.dialogState.state!,
        source: selectedNode
          ? instance.nodeMap.get(selectedNode)?.containerId
          : undefined,
      });
    }

    function onOpenTerminal() {
      closeDetails();

      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      terminalDialogState.openWith({
        lab: props.dialogState.state!,
        node: selectedNode,
      });
    }

    function openWebSsh() {
      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      const instance = props.dialogState.state.instance;
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

      if (!cyRef.current || !props.dialogState.state) {
        return undefined;
      }

      // Return empty context menu if selected node is a group node
      if (cyRef.current.getElementById(selectedNode).hasClass('drawn-shape')) {
        return;
      }

      const nodeMap = props.dialogState.state.instance?.nodeMap;
      const node = nodeMap?.get(selectedNode);

      const isNodeAvailable = nodeMap?.has(selectedNode);
      const isNodeRunning = nodeMap?.get(selectedNode)?.state === 'running';

      const entries: MenuItem[] = [
        {
          label: 'Start Node',
          icon: 'pi pi-power-off',
          command: onNodeStart,
          disabled: isNodeRunning || !isNodeAvailable,
        },
        {
          label: 'Stop Node',
          icon: 'pi pi-power-off',
          command: onNodeStop,
          disabled: !isNodeRunning || !isNodeAvailable,
        },
        {
          label: 'Restart Node',
          icon: 'pi pi-sync',
          command: onNodeRestart,
          disabled: !isNodeRunning || !isNodeAvailable,
        },
        {
          separator: true,
        },
        {
          label: 'Open Terminal',
          icon: <span className="material-symbols-outlined">terminal</span>,
          command: onOpenTerminal,
          disabled: !isNodeRunning || !isNodeAvailable,
        },
        {
          label: 'Show Logs',
          icon: (
            <span className="material-symbols-outlined">
              quick_reference_all
            </span>
          ),
          disabled: !isNodeAvailable,
          command: onOpenLogs,
        },
      ];

      if (node?.webSSH) {
        entries.push({
          label: 'Web SSH',
          icon: 'pi pi-external-link',
          command: openWebSsh,
        });
      }

      return entries;
    }, [selectedNode, props.dialogState.state]);

    function onGraphClick(event: cytoscape.EventObject) {
      if (
        event.target === cyRef.current &&
        nodeContextMenuRef.current !== null
      ) {
        nodeDetailOverlay.current!.close();
      }
    }

    function onMouseDown() {
      closeDetails();
    }

    function initCytoscape(cy: cytoscape.Core) {
      cy.minZoom(0.3);
      cy.maxZoom(10);

      cy.on('tap', 'node', onNodeClick);
      cy.on('cxttap', onGraphContext);
      cy.on('render', drawGridOverlay);
      cy.on('tap', onGraphClick);
      cy.on('zoom', onZoom);
      cy.on('mousedown', onMouseDown);
      cy.style().fromJson(topologyStyle).update();
    }

    function drawGridOverlay(event: cytoscape.EventObject) {
      if (!gridCanvasRef.current || !containerRef.current || !event.cy) return;

      drawGraphGrid(containerRef.current, gridCanvasRef.current, event.cy);
    }

    useEffect(() => {
      if (!props.dialogState.state) return;

      if (logDialogState.isOpen) {
        if (!props.dialogState.state.instance) {
          logDialogState.close();
        } else {
          logDialogState.openWith({
            lab: props.dialogState.state,
          });
        }
      }
    }, [props.dialogState.state]);

    function onClose() {
      // Close child dialogs before closing lab dialog itself
      if (logDialogState.isOpen) {
        logDialogState.close();
      } else if (terminalDialogState.isOpen) {
        terminalDialogState.close();
      } else {
        graphInitiallyFitted.current = false;
        props.dialogState.close();
      }
    }

    function onFitGraph() {
      if (!cyRef.current) return;

      setTimeout(() => {
        cyRef.current!.fit(cyRef.current!.elements(), 180);
      }, 200);
    }

    function closeDetails() {
      nodeDetailOverlay.current?.close();
    }

    function onDialogDragStart() {
      closeDetails();
    }

    function onDialogDragEnd() {
      cyRef.current?.invalidateDimensions();
    }

    return (
      <>
        <SBDialog
          isOpen={props.dialogState.isOpen}
          onClose={onClose}
          onShow={onOpen}
          headerTitle={
            <If condition={props.dialogState.state}>
              <StateIndicator lab={props.dialogState.state!} showText={false} />
              <span className="sb-lab-dialog-title-name">
                {groupName + ' / '}
              </span>
              <span>{props.dialogState.state!.name}</span>
            </If>
          }
          hideButtons={true}
          className="sb-lab-dialog"
          draggable={true}
          onDragStart={onDialogDragStart}
          onDragEnd={onDialogDragEnd}
        >
          <If condition={props.dialogState.state}>
            <div className="topology-graph-container" ref={containerRef}>
              <LabDialogPanelProperties lab={props.dialogState.state!} />
              <LabDialogPanelAdmin
                lab={props.dialogState.state!}
                onOpenLogs={onOpenLogs}
                labelsHidden={hostsHidden}
                setLabelsHidden={setHostsHidden}
                onDestroyLabRequest={() =>
                  props.onDestroyLabRequest(props.dialogState.state!)
                }
              />
              <canvas ref={gridCanvasRef} className="grid-canvas" />
              <CytoscapeComponent
                className="cytoscape-container"
                elements={[]}
                cy={(cy: cytoscape.Core) => {
                  cyRef.current = cy;
                  setIsCyReady(true);
                }}
              />
            </div>
          </If>
        </SBDialog>
        <ContextMenu model={networkContextMenuItems} ref={nodeContextMenuRef} />
        <LogDialog dialogState={logDialogState} />
        <TerminalDialog dialogState={terminalDialogState} />
        <LabDetailsOverlay
          overlayRef={nodeDetailOverlay}
          lab={props.dialogState.state}
          nodeId={selectedNode}
          onOpenTerminal={onOpenTerminal}
          onOpenLogs={onOpenLogs}
          onNodeStart={onNodeStart}
          onNodeStop={onNodeStop}
          onNodeRestart={onNodeRestart}
        />
      </>
    );
  }
);

export default LabDialog;
