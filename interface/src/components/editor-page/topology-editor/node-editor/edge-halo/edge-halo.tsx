import React from 'react';

import cytoscape, {EdgeSingular} from 'cytoscape';
import {observer} from 'mobx-react-lite';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {Position} from '@sb/types/types';

import './edge-halo.sass';

// The halo is wider than the link on each side, like the one of selected lines
const HALO_WIDTH = 8;

interface EdgeHaloProps {
  getCy: () => cytoscape.Core | null;
}

/**
 * The halo behind the link whose context menu is open. It is placed in the
 * layer behind the graph, like the selection of the other elements.
 */
const EdgeHalo = observer((props: EdgeHaloProps) => {
  const graphSelection = useGraphSelection();

  const edge = graphSelection.menuEdgeId
    ? props.getCy()?.getElementById(graphSelection.menuEdgeId)
    : undefined;
  if (!edge?.nonempty()) return null;

  return (
    <svg className="sb-edge-halo">
      <path
        className="sb-graph-line-selection"
        d={edgePath(edge)}
        strokeWidth={edge.numericStyle('width') + HALO_WIDTH}
      />
    </svg>
  );
});

/**
 * Returns the path of a link as cytoscape draws it. Curved links pass through
 * the midpoints between their control points.
 */
function edgePath(edge: EdgeSingular): string {
  const source = edge.sourceEndpoint();
  const target = edge.targetEndpoint();
  const controls: Position[] = edge.controlPoints() ?? [];

  if (controls.length === 0) {
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }

  return controls.reduce((path, control, index) => {
    const next =
      index === controls.length - 1
        ? target
        : {
            x: (control.x + controls[index + 1].x) / 2,
            y: (control.y + controls[index + 1].y) / 2,
          };

    return `${path} Q ${control.x} ${control.y} ${next.x} ${next.y}`;
  }, `M ${source.x} ${source.y}`);
}

export default EdgeHalo;
