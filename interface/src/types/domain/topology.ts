import {TopologyDefinition} from '@sb/types/domain/topology-definition';
import {User} from '@sb/types/domain/user';
import {Position, uuid4} from '@sb/types/types';

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

// A topology of a collection, as the server stores it
export type Topology = {
  id: uuid4;
  collectionId: uuid4;
  creator: User;
  syncUrl: string;
  bindFiles: BindFile[];
  lastDeployFailed: boolean;

  // What the topology means, with its document and its text
  definition: TopologyDefinition;
  annotations: TopologyAnnotations;
};

// The topology a lab was deployed with
export type RunTopology = {
  definition: TopologyDefinition;
  annotations: TopologyAnnotations;
};

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

// The graph-* labels of a node, which held its layout before there were annotations
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
