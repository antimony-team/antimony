import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import LabDialogPanelAdmin from '@sb/components/dashboard-page/lab-dialog/lab-dialog-panel-admin/lab-dialog-panel-admin';
import LabDialogPanelProperties from '@sb/components/dashboard-page/lab-dialog/lab-dialog-panel-properties/lab-dialog-panel-properties';
import LogDialog, {
  LogDialogState,
} from '@sb/components/dashboard-page/log-dialog/log-dialog';
import StateIndicator from '@sb/components/dashboard-page/state-indicator/state-indicator';

import './lab-dialog.sass';
import {
  useCollectionStore,
  useDeviceStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogState, useDialogState} from '@sb/lib/utils/hooks';
import {drawGrid, generateGraph} from '@sb/lib/utils/utils';
import {If} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';
import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {EventObject} from 'cytoscape';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape, {ElementDefinition} from 'cytoscape';
import {topologyStyle} from '@sb/lib/cytoscape-styles';

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
    const [cyReady, setCyReady] = useState<boolean>(false);
    const collectionStore = useCollectionStore();
    const deviceStore = useDeviceStore();
    const topologyStore = useTopologyStore();

    const groupName = props.dialogState.state
      ? collectionStore.lookup.get(props.dialogState.state.collectionId)
          ?.name ?? 'unknown'
      : 'unknown';

    const openTopology = props.dialogState.state
      ? topologyStore.lookup.get(props.dialogState.state.topologyId)
      : null;

    const graphData: ElementDefinition[] = useMemo(() => {
      console.log(openTopology);
      if (!openTopology) return [];
      return generateGraph(openTopology, deviceStore, topologyStore.manager);
    }, [deviceStore, openTopology, topologyStore.manager]);

    function onContext(event: cytoscape.EventObject) {
      if (!nodeContextMenuRef.current) return;

      const target = event.target;

      if (target.isNode && target.isNode()) {
        const nodeId = target.id();
        target.select(); // Optional: visually select the node
        setSelectedNode(nodeId);
        nodeContextMenuRef.current.show(
          event.originalEvent as unknown as React.MouseEvent
        );
      }

      event.originalEvent?.preventDefault();
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

    const networkContextMenuItems: MenuItem[] | undefined = useMemo(() => {
      if (selectedNode === null) return undefined;

      return [
        {
          label: 'Stop Node',
          icon: 'pi pi-power-off',
        },
        {
          label: 'Restart Node',
          icon: 'pi pi-sync',
        },
        {
          separator: true,
        },
        {
          label: 'Copy Host',
          icon: 'pi pi-copy',
        },
        {
          label: 'Web SSH',
          icon: 'pi pi-external-link',
        },
        {
          label: 'View Logs',
          icon: 'pi pi-search',
          command: onViewLogs,
        },
      ];
    }, [selectedNode]);

    function drawGridOverlay(cy: cytoscape.Core) {
      const canvas = gridCanvasRef.current;
      if (!canvas || !containerRef.current) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const resizeCanvas = () => {
        canvas.width = containerRef.current!.clientWidth;
        canvas.height = containerRef.current!.clientHeight;
      };

      const draw = () => {
        resizeCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid(ctx, cy.zoom(), cy.pan());
      };

      cy.on('render zoom pan', draw);
      window.addEventListener('resize', draw);

      draw();

      return () => {
        cy.off('render zoom pan', draw);
        window.removeEventListener('resize', draw);
      };
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
        props.dialogState.close();
      }
    }
    //Helper useEffect to center Graph evertime Dialog gets opend
    useEffect(() => {
      setCyReady(false);
    }, [props.dialogState.isOpen]);

    useEffect(() => {
      if (cyRef.current) {
        centerGraph(cyRef.current);
      }
    }, [cyReady]);

    function centerGraph(cy: cytoscape.Core) {
      if (containerRef.current) {
        cy.resize();
        cy.fit(cy.elements(), 60);
        const viewW = containerRef.current!.clientWidth;
        const viewH = containerRef.current!.clientHeight;
        const offsetX = viewW * 0.1;
        const offsetY = viewH * 0.1;
        cy.panBy({x: offsetX, y: offsetY});
      }
    }
    return (
      <>
        <SBDialog
          isOpen={props.dialogState.isOpen}
          onClose={onClose}
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
                onDestroyLabRequest={() =>
                  props.onDestroyLabRequest(props.dialogState.state!)
                }
              />
              <canvas ref={gridCanvasRef} className="grid-canvas" />
              <CytoscapeComponent
                className="cytoscape-container"
                elements={graphData}
                cy={(cy: cytoscape.Core) => {
                  cyRef.current = cy;
                  cy.nodes().lock();
                  drawGridOverlay(cy);
                  cy.on('tap', 'node', onClick);
                  cy.on('cxttap', 'node', onContext);
                  cy.on('tap', (event: EventObject) => {
                    if (event.target === cyRef.current) {
                      onBackgroundClick(event);
                    }
                  });
                  cy.style().fromJson(topologyStyle).update();
                  setCyReady(true);
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
      </>
    );
  }
);

export default LabDialog;
