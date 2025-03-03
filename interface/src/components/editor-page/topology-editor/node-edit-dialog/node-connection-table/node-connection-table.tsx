import React from 'react';

import {Image} from 'primereact/image';
import {InputNumber, InputNumberChangeEvent} from 'primereact/inputnumber';

import {NodeEditor} from '@sb/lib/node-editor';
import {NodeConnection} from '@sb/types/domain/topology';
import {Choose, Otherwise, When} from '@sb/types/control';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';

import './node-connection-table.sass';

interface NodeConnectionTableProps {
  nodeEditor: NodeEditor;
}

const NodeConnectionTable = (props: NodeConnectionTableProps) => {
  const topologyStore = useTopologyStore();
  const deviceStore = useDeviceStore();

  function onHostChange(
    connection: NodeConnection,
    event: InputNumberChangeEvent
  ) {
    if (!event.value) return;

    props.nodeEditor.modifyConnection({
      ...connection,
      hostInterfaceIndex: event.value,
    });
  }

  function onTargetChange(
    connection: NodeConnection,
    event: InputNumberChangeEvent
  ) {
    if (!event.value) return;

    props.nodeEditor.modifyConnection({
      ...connection,
      targetInterfaceIndex: event.value,
    });
  }

  const nodeConnections = topologyStore.manager.topology?.connectionMap.get(
    props.nodeEditor.getNodeName()
  );

  return (
    <div className="node-connection-table">
      <Choose>
        <When condition={nodeConnections}>
          {nodeConnections!.map(connection => (
            <div className="node-connection-table-entry" key={connection.index}>
              <div className="node-connection-table-entry-group">
                <Image
                  src={deviceStore.getNodeIcon(
                    props.nodeEditor.getNode()?.kind
                  )}
                  width="45px"
                />
                <span className="node-connection-table-entry-text">
                  {connection.hostNode}:{connection.hostInterface}
                </span>
                <InputNumber
                  value={connection.hostInterfaceIndex}
                  min={connection.hostInterfaceConfig.interfaceStart}
                  max={99}
                  onChange={e => onHostChange(connection, e)}
                  showButtons
                />
              </div>
              <div className="node-connection-table-entry-group">
                <Image
                  src={deviceStore.getNodeIcon(
                    props.nodeEditor.getTopology().toJS().topology.nodes[
                      connection.targetNode
                    ]?.kind
                  )}
                  width="45px"
                />

                <span className="node-connection-table-entry-text">
                  {connection.targetNode}:{connection.targetInterface}
                </span>
                <InputNumber
                  value={connection.targetInterfaceIndex}
                  min={connection.targetInterfaceConfig.interfaceStart}
                  max={99}
                  onChange={e => onTargetChange(connection, e)}
                  showButtons
                />
              </div>
            </div>
          ))}
        </When>
        <Otherwise>
          <span className="node-connection-table-empty">
            This node does not have any connections.
          </span>
        </Otherwise>
      </Choose>
    </div>
  );
};

export default NodeConnectionTable;
