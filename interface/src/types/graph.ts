import React from 'react';
import {IdType} from 'vis-network';
import {Position} from '@sb/types/types';

export interface GraphEventPointer {
  DOM: Position;
  canvas: Position;
}

export interface GraphBaseEvent {
  event: React.SyntheticEvent;
  pointer: GraphEventPointer;
}

export interface GraphNodeClickEvent extends GraphBaseEvent {
  nodes: IdType[];
  edges: IdType[];
}

export interface GraphNodeHoverEvent extends GraphBaseEvent {
  nodeId: IdType;
}

export interface GraphEdgeHoverEvent extends GraphBaseEvent {
  edgeId: IdType;
}
