import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
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
import classNames from 'classnames';

import cytoscape, {type EventObject} from 'cytoscape';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
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
    const [isMenuVisible, setMenuVisible] = useState(false);
    const logDialogState = useDialogState<LogDialogState>();
    const terminalDialogState = useDialogState<TerminalDialogState>();

    const [isCyReady, setIsCyReady] = useState<boolean>(false);
    const collectionStore = useCollectionStore();
    const deviceStore = useDeviceStore();
    const labStore = useLabStore();
    const topologyStore = useTopologyStore();

    const groupName = useMemo(() => {
      if (!props.dialogState.state) return;

      const collectionId = props.dialogState.state.collectionId;
      if (!collectionStore.lookup.has(collectionId)) return;

      return collectionStore.lookup.get(collectionId)!.name;
    }, [props.dialogState.state, collectionStore.lookup]);

    const openTopology = props.dialogState.state
      ? topologyStore.lookup.get(props.dialogState.state.topologyId)
      : null;

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
      if (!cyRef.current || !openTopology) return;

      cyRef.current.batch(() => {
        cyRef.current!.elements().remove();

        const elements = generateGraph(
          openTopology,
          deviceStore,
          topologyStore.manager,
          props.dialogState.state?.instance
        );

        for (const element of elements) {
          cyRef.current!.add(element);
        }

        if (!graphInitiallyFitted.current) {
          graphInitiallyFitted.current = true;
          onFitGraph();
        }

        cyRef.current!.nodes().lock();
      });
    }, [props.dialogState.state]);

    const onOpen = useCallback(() => {
      if (!cyRef.current) return;

      initCytoscape(cyRef.current);
      updateGraph();
    }, [updateGraph, props.dialogState.state]);

    useEffect(() => {
      updateGraph();
    }, [props.dialogState.state]);

    function onNodeContext(event: cytoscape.EventObject) {
      if (!nodeContextMenuRef.current || !cyRef.current) return;

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

    function onClick(event: cytoscape.EventObject) {
      const target = event.target;

      if (target.isNode && target.isNode()) {
        setSelectedNode(target.id());
        setMenuVisible(true);
      } else {
        setMenuVisible(false);
      }
    }

    function onCopyActiveNode() {
      if (!props.dialogState.state) return;

      // TODO(): Reimplement
      // const nodeMeta = labStore.metaLookup
      //   .get(props.lab.id)!
      //   .get(selectedNode as string);
      //
      // if (nodeMeta) {
      //   const textToCopy = nodeMeta.webSsh + ':' + nodeMeta.port;
      //
      //   navigator.clipboard.writeText(textToCopy).catch(err => {
      //     console.error('Failed to copy to clipboard:', err);
      //   });
      // }
    }

    function onNodeStart() {
      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      const instance = props.dialogState.state?.instance;
      const containerId = instance.nodeMap.get(selectedNode)!.containerId;

      void labStore.startNode(props.dialogState.state, containerId);
    }

    function onNodeStop() {
      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      const instance = props.dialogState.state?.instance;
      const containerId = instance.nodeMap.get(selectedNode)!.containerId;

      void labStore.stopNode(props.dialogState.state, containerId);
    }

    function onNodeRestart() {
      if (
        !selectedNode ||
        !props.dialogState.state?.instance ||
        !props.dialogState.state.instance.nodeMap.has(selectedNode)
      ) {
        return;
      }

      const instance = props.dialogState.state?.instance;
      const containerId = instance.nodeMap.get(selectedNode)!.containerId;

      void labStore.restartNode(props.dialogState.state, containerId);
    }

    function onOpenActiveNode() {
      if (!props.dialogState.state) return;

      // TODO(): Reimplement

      // const nodeMeta = labStore.metaLookup
      //   .get(props.lab.id)!
      //   .get(selectedNode as string);
      //
      // if (nodeMeta) window.open(nodeMeta.webSsh);
    }

    function onViewLogs() {
      if (!selectedNode) return;

      const instance = props.dialogState.state!.instance!;

      logDialogState.openWith({
        lab: props.dialogState.state!,
        source: instance.nodeMap.get(selectedNode)!.containerId,
      });
    }

    function onOpenTerminal() {
      const instance = props.dialogState.state!.instance!;

      const nodeId = selectedNode
        ? instance.nodeMap.get(selectedNode)!.containerId
        : null;

      terminalDialogState.openWith({
        lab: props.dialogState.state!,
        nodeId: nodeId,
      });
    }

    const graphContextMenuModel = [
      {
        label: 'Center Graph',
        icon: 'pi pi-plus',
        command: onFitGraph,
      },
    ];

    const networkContextMenuItems: MenuItem[] | undefined = useMemo(() => {
      if (!cyRef.current || !props.dialogState.state?.instance?.nodeMap) {
        return undefined;
      }

      // If the selected node is null, the graph itself is selected
      if (selectedNode === null) {
        return graphContextMenuModel;
      }

      // Return empty context menu if selected node is a group node
      if (cyRef.current.getElementById(selectedNode).hasClass('drawn-shape')) {
        return;
      }

      const nodeMap = props.dialogState.state.instance.nodeMap;
      const node = nodeMap.get(selectedNode)!;
      const isNodeRunning = node.state === 'running';

      const entries = [
        {
          label: 'Start Node',
          icon: 'pi pi-power-off',
          command: onNodeStart,
          disabled: isNodeRunning,
        },
        {
          label: 'Stop Node',
          icon: 'pi pi-power-off',
          command: onNodeStop,
          disabled: !isNodeRunning,
        },
        {
          label: 'Restart Node',
          icon: 'pi pi-sync',
          command: onNodeRestart,
          disabled: !isNodeRunning,
        },
        {
          separator: true,
        },
        {
          label: 'Copy Host',
          icon: 'pi pi-copy',
        },
        {
          label: 'Open Terminal',
          icon: <span className="material-symbols-outlined">terminal</span>,
          command: onOpenTerminal,
          disabled: !isNodeRunning,
        },
        {
          label: 'View Logs',
          icon: <span className="material-symbols-outlined">find_in_page</span>,
          command: onViewLogs,
        },
      ];

      if (node.webSSH) {
        entries.push({
          label: 'Web SSH',
          icon: 'pi pi-external-link',
        });
      }

      return entries;
    }, [selectedNode, props.dialogState.state]);

    function initCytoscape(cy: cytoscape.Core) {
      cy.on('tap', 'node', onClick);
      cy.on('cxttap', onNodeContext);
      cy.on('render', drawGridOverlay);
      cy.on('tap', (event: EventObject) => {
        if (event.target === cyRef.current) {
          onBackgroundClick(event);
        }
      });
      cy.style().fromJson(topologyStyle).update();
    }

    function drawGridOverlay(event: cytoscape.EventObject) {
      if (!gridCanvasRef.current || !containerRef.current || !event.cy) return;

      drawGraphGrid(containerRef.current, gridCanvasRef.current, event.cy);
    }

    const onBackgroundClick = useCallback((event: cytoscape.EventObject) => {
      if (
        event.target === cyRef.current &&
        nodeContextMenuRef.current !== null
      ) {
        setMenuVisible(false);
      }
    }, []);

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
      // Close log dialog first if open
      if (logDialogState.isOpen) {
        logDialogState.close();
      } else {
        graphInitiallyFitted.current = false;
        props.dialogState.close();
      }
    }

    function onFitGraph() {
      if (!cyRef.current) return;

      cyRef.current.fit(cyRef.current.elements(), 280);
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
        >
          <If condition={props.dialogState.state}>
            <div className="topology-graph-container" ref={containerRef}>
              <LabDialogPanelProperties lab={props.dialogState.state!} />
              <LabDialogPanelAdmin
                lab={props.dialogState.state!}
                onShowLogs={() => {
                  logDialogState.openWith({
                    lab: props.dialogState.state!,
                  });
                }}
                hostsHidden={hostsHidden}
                setHostsHidden={setHostsHidden}
                onOpenTerminal={onOpenTerminal}
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
            <div
              className={classNames(
                'sb-lab-dialog-footer sb-animated-overlay',
                {
                  visible: isMenuVisible && selectedNode !== null,
                }
              )}
            >
              <span className="sb-lab-dialog-footer-name">{selectedNode}</span>
              <Button
                label="Copy Host"
                icon="pi pi-copy"
                outlined
                onClick={onCopyActiveNode}
                aria-label="Copy Host"
              />
              <Button
                label="Web SSH"
                icon="pi pi-external-link"
                outlined
                onClick={onOpenActiveNode}
                aria-label="Web SSH"
              />
            </div>
          </If>
        </SBDialog>
        <ContextMenu model={networkContextMenuItems} ref={nodeContextMenuRef} />
        <LogDialog dialogState={logDialogState} />
        <TerminalDialog dialogState={terminalDialogState} />
      </>
    );
  }
);

export default LabDialog;
