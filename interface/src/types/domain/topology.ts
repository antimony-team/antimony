import {InterfaceConfig} from '@sb/types/domain/device-info';
import {User} from '@sb/types/domain/user';
import {Position, uuid4, YAMLDocument} from '@sb/types/types';

export type EditingFile = BindFile | Topology;

// The files of a topology that can be opened in the text editor
export enum TopologyFileType {
  Definition,
  Annotations,
}

export type BindFileIn = {
  filePath: string;
  content: string;
};

export type BindFile = BindFileIn & {
  id: uuid4;
  topologyId: uuid4;
};

export type TopologyIn = {
  collectionId?: uuid4;
  definition?: string;
  annotations?: string;
  syncUrl?: string;
};

export type TopologyOut = TopologyIn & {
  id: uuid4;
  creator: User;
  bindFiles: BindFile[];
  lastDeployFailed: boolean;
};

export type Topology = TopologyMeta & {
  id: uuid4;
  name: string;
  definition: YAMLDocument<TopologyDefinition>;
  definitionString: string;
  annotations: TopologyAnnotations;
  annotationsString: string;
  collectionId: uuid4;
  creator: User;
  syncUrl: string;
  bindFiles: BindFile[];
  lastDeployFailed: boolean;
};

export type RunTopology = TopologyMeta & {
  definition: YAMLDocument<TopologyDefinition>;
  annotations: TopologyAnnotations;
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
 * The annotations of a topology, which hold the layout of its graph.
 *
 * Only the fields used by Antimony are typed, all others are kept as they are.
 */
export interface TopologyAnnotations {
  nodeAnnotations?: NodeAnnotation[];

  [key: string]: unknown;
}

export interface NodeAnnotation {
  // Name of the node in the topology definition
  id: string;
  position?: Position;
  geoCoordinates?: GeoCoordinates;
  icon?: string;
  group?: string;
  level?: string;

  [key: string]: unknown;
}

export interface GeoCoordinates {
  lat: number;
  lng: number;
}

/**
 * Metadata object to hold the connections and positions of nodes in a topology.
 *
 * This object is generated from the definition object and is not persisted.
 */
export type TopologyMeta = {
  nodeCount: number;
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
  image?: string;
  labels?: NodeLabels;
}

export interface NodeLabels {
  'graph-icon'?: string;
  'graph-group'?: string;
  'graph-level'?: number;
  'graph-posX'?: string;
  'graph-posY'?: string;
  'graph-geoCoordinateLat'?: string;
  'graph-geoCoordinateLng'?: string;

  [key: string]: string | number | undefined;
}
