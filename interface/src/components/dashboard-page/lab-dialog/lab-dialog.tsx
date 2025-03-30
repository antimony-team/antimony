import useResizeObserver from '@react-hook/resize-observer';
import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import LabDialogPanelAdmin from '@sb/components/dashboard-page/lab-dialog/lab-dialog-panel-admin/lab-dialog-panel-admin';
import LabDialogPanelProperties from '@sb/components/dashboard-page/lab-dialog/lab-dialog-panel-properties/lab-dialog-panel-properties';
import LogDialog, {
  LogDialogState,
} from '@sb/components/dashboard-page/log-dialog/log-dialog';
import StateIndicator from '@sb/components/dashboard-page/state-indicator/state-indicator';

import {NetworkOptions} from '@sb/components/editor-page/topology-editor/node-editor/network.conf';

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
import {GraphNodeClickEvent} from '@sb/types/graph';
import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {ContextMenu} from 'primereact/contextmenu';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import Graph from 'react-graph-vis';

import {DataSet} from 'vis-data/peer';
import {IdType, Network} from 'vis-network';
import {Data} from 'vis-network/declarations/network/Network';

interface LabDialogProps {
  dialogState: DialogState<Lab>;
}

const LabDialog: React.FC<LabDialogProps> = observer(
  (props: LabDialogProps) => {
    const [network, setNetwork] = useState<Network | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [hostsHidden, setHostsHidden] = useState(false);
    const nodeContextMenuRef = useRef<ContextMenu | null>(null);
    const [selectedNode, setSelectedNode] = useState<IdType | null>(null);
    const [isMenuVisible, setMenuVisible] = useState(false);
    const logDialogState = useDialogState<LogDialogState>();

    const collectionStore = useCollectionStore();
    const deviceStore = useDeviceStore();
    const topologyStore = useTopologyStore();

    useResizeObserver(containerRef, () => {
      if (network) network.redraw();
    });

    const groupName = props.dialogState.state
      ? collectionStore.lookup.get(props.dialogState.state.collectionId)
          ?.name ?? 'unknown'
      : 'unknown';

    const openTopology = props.dialogState.state
      ? topologyStore.lookup.get(props.dialogState.state.topologyId)
      : null;

    const graphData: Data = useMemo(() => {
      if (!openTopology) {
        return {nodes: new DataSet(), edges: new DataSet()};
      }

      return generateGraph(openTopology, deviceStore, topologyStore.manager);
    }, [deviceStore, openTopology, topologyStore.manager]);

    function onContext(event: GraphNodeClickEvent) {
      if (!nodeContextMenuRef.current) return;

      const targetNode = network?.getNodeAt(event.pointer.DOM);
      if (targetNode !== undefined) {
        network?.selectNodes([targetNode]);
        setSelectedNode(targetNode as number);
        nodeContextMenuRef.current.show(event.event);
      }

      event.event.preventDefault();
    }

    function onClick(selectData: GraphNodeClickEvent) {
      if (!network) return;

      const targetNode = network?.getNodeAt(selectData.pointer.DOM);

      if (targetNode !== undefined) {
        setSelectedNode(targetNode as number);
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

    const networkContextMenuItems = useMemo(() => {
      if (selectedNode !== null) {
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
          },
        ];
      }
    }, [selectedNode]);

    useEffect(() => {
      if (!network) return;
      network.on('beforeDrawing', drawGrid);

      return () => network.off('beforeDrawing', drawGrid);
    }, [network]);

    useEffect(() => {
      if (network) {
        network.setData(graphData);
      }
    }, [network, graphData]);

    useEffect(() => {
      if (!props.dialogState.state) return;

      if (logDialogState.isOpen) {
        logDialogState.openWith({
          lab: props.dialogState.state,
        });
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
                onShowLogs={() =>
                  logDialogState.openWith({
                    lab: props.dialogState.state!,
                  })
                }
                hostsHidden={hostsHidden}
                setHostsHidden={setHostsHidden}
              />
              <Graph
                graph={{nodes: [], edges: []}}
                options={{
                  ...NetworkOptions,
                  interaction: {
                    dragNodes: false,
                    dragView: false,
                    zoomView: false,
                  },
                }}
                events={{
                  oncontext: onContext,
                  click: onClick,
                }}
                getNetwork={setNetwork}
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
