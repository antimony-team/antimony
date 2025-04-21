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

export type CytoscapeElement = {
  data: {
    id: string;
    label?: string;
    title?: string;
    kind?: string;
    image?: string;
    source?: string;
    target?: string;
    sourceLabel?: string;
    targetLabel?: string;
  };
  position?: {
    x: number | undefined;
    y: number | undefined;
  };
  classes?: string;
};
