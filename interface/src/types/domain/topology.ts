import {Position, uuid4, YAMLDocument} from '@sb/types/types';
import {InterfaceConfig} from '@sb/types/domain/device-info';

export type TopologyIn = {
  collectionId: uuid4;
  definition: string;
  metadata: string;
  gitSourceUrl: string;
};

export type TopologyOut = TopologyIn & {
  id: uuid4;
  creatorId: uuid4;
};

export type Topology = TopologyMeta & {
  id: uuid4;
  definition: YAMLDocument<TopologyDefinition>;
  collectionId: uuid4;
  creatorId: uuid4;
};

export interface TopologyDefinition {
  name: string;
  topology: {
    nodes: {[nodeName: string]: TopologyNode};
    links: {
      endpoints: string;
    };
  };
}

/**
 * Metadata object to hold the connections and positions of nodes in a topology.
 *
 * This object is generated from the definition object and is not persisted.
 */
export type TopologyMeta = {
  positions: Map<string, Position>;
  connections: NodeConnection[];
  connectionMap: Map<string, NodeConnection[]>;
};

/**
 * Holds information about a link between two nodes.
 *
 * This object is generated from the definition object and is not persisted.
 */
export interface NodeConnection {
  index: number;

  hostNode: string;
  hostInterface: string;
  hostInterfaceIndex: number;
  hostInterfaceConfig: InterfaceConfig;

  targetNode: string;
  targetInterface: string;
  targetInterfaceIndex: number;
  targetInterfaceConfig: InterfaceConfig;
}

export interface TopologyNode {
  kind?: string;
}
