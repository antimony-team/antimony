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
  collectionId: uuid4;
  definition: string;
  annotations: string;
  syncUrl: string;
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
    links?: TopologyLink[];
  };
}

// A link between two nodes, its endpoints are e.g. ['srl1:e1-1', 'srl2:e1-1']
export interface TopologyLink {
  endpoints: string[];

  [key: string]: unknown;
}

/**
 * The annotations of a topology, which hold the layout of its graph.
 *
 * Only the fields used by Antimony are typed, all others are kept as they are.
 */
export interface TopologyAnnotations {
  nodeAnnotations?: NodeAnnotation[];
  freeTextAnnotations?: FreeTextAnnotation[];
  freeShapeAnnotations?: FreeShapeAnnotation[];
  groupStyleAnnotations?: GroupStyleAnnotation[];

  [key: string]: unknown;
}

export interface NodeAnnotation {
  // Name of the node in the topology definition
  id: string;
  position?: Position;
  geoCoordinates?: GeoCoordinates;
  icon?: string;
  groupId?: string;

  // Legacy group membership by group name, replaced by groupId
  group?: string;
  level?: string;

  [key: string]: unknown;
}

export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double';

/**
 * A group of nodes, shown as a box behind its members. The position is the
 * top left corner of the box.
 */
export interface GroupStyleAnnotation {
  id: string;
  name: string;
  level: string;
  position: Position;
  width: number;
  height: number;
  parentId?: string;
  groupId?: string;
  zIndex?: number;
  backgroundColor?: string;

  // Opacity of the background color from 0 to 100
  backgroundOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: BorderStyle;
  borderRadius?: number;
  labelColor?: string;
  labelPosition?: string;

  [key: string]: unknown;
}

/**
 * A rectangle, circle or line. Rectangles and circles are positioned by their
 * top left corner, lines go from the position to the end position.
 */
export interface FreeShapeAnnotation {
  id: string;
  shapeType: 'rectangle' | 'circle' | 'line';
  position: Position;
  width?: number;
  height?: number;
  endPosition?: Position;
  groupId?: string;
  zIndex?: number;
  fillColor?: string;
  fillOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: Exclude<BorderStyle, 'double'>;
  cornerRadius?: number;
  lineStartArrow?: boolean;
  lineEndArrow?: boolean;
  lineArrowSize?: number;

  [key: string]: unknown;
}

export interface FreeTextAnnotation {
  id: string;
  text: string;
  position: Position;
  width?: number;
  height?: number;
  groupId?: string;
  zIndex?: number;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';

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
