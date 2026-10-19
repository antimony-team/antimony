import React, {useCallback, useEffect, useState} from 'react';

import {Image} from 'primereact/image';
import {InputNumber, InputNumberChangeEvent} from 'primereact/inputnumber';

import {interfaceName, matchInterface} from '@sb/lib/graph/interfaces';
import {NodeEditor} from '@sb/lib/node-editor';
import {useDeviceStore} from '@sb/lib/stores/root-store';
import {Choose, Otherwise, When} from '@sb/types/control';
import {TopologyLink} from '@sb/types/domain/topology-definition';

import './node-connection-table.sass';

interface NodeConnectionTableProps {
  nodeEditor: NodeEditor;
}

const NodeConnectionTable = (props: NodeConnectionTableProps) => {
  const deviceStore = useDeviceStore();
  const [links, setLinks] = useState<TopologyLink[]>([]);

  const onTopologyUpdate = useCallback(() => {
    setLinks(props.nodeEditor.getLinks());
  }, [props.nodeEditor]);

  useEffect(() => {
    props.nodeEditor.onEdit.register(onTopologyUpdate);
    onTopologyUpdate();

    return () => props.nodeEditor.onEdit.unregister(onTopologyUpdate);
  }, [props.nodeEditor, onTopologyUpdate]);

  // The ends of a link from the current node, the first one is at the node
  function linkEnds(link: TopologyLink) {
    const hostIndex = Math.max(
      link.endpoints.findIndex(
        endpoint => endpoint.node === props.nodeEditor.getNodeName(),
      ),
      0,
    );

    return [hostIndex, 1 - hostIndex].map(endpointIndex => {
      const endpoint = link.endpoints[endpointIndex];
      const config = deviceStore.getInterfaceConfig(
        props.nodeEditor.getTopology().nodes.get(endpoint.node)?.device,
      );

      // The number is changed in the pattern the interface is written in
      const match = matchInterface(endpoint.interface, config);

      return {
        endpointIndex,
        endpoint,
        pattern: match?.pattern ?? config.interfaces[0],
        number: match?.number ?? null,
      };
    });
  }

  function onInterfaceChange(
    link: TopologyLink,
    end: ReturnType<typeof linkEnds>[number],
    event: InputNumberChangeEvent,
  ) {
    if (!event.value) return;

    props.nodeEditor.renameInterface(
      link.index,
      end.endpointIndex,
      interfaceName(event.value, end.pattern),
    );
  }

  return (
    <div className="node-connection-table">
      <Choose>
        <When condition={links.length > 0}>
          {links.map(link => (
            <div className="node-connection-table-entry" key={link.index}>
              {linkEnds(link).map(end => (
                <div
                  className="node-connection-table-entry-group"
                  key={end.endpointIndex}
                >
                  <Image
                    src={deviceStore.getNodeIcon(
                      props.nodeEditor.getNodeIcon(end.endpoint.node),
                    )}
                    width="45px"
                    alt=""
                  />
                  <span className="node-connection-table-entry-text">
                    {end.endpoint.node}:{end.endpoint.interface}
                  </span>
                  <InputNumber
                    value={end.number}
                    min={end.pattern.start}
                    max={99}
                    onChange={e => onInterfaceChange(link, end, e)}
                    showButtons
                    aria-label={`Interface of ${end.endpoint.node}`}
                  />
                </div>
              ))}
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
