import React, {CSSProperties, MouseEvent} from 'react';

import {observer} from 'mobx-react-lite';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {LayerItem, shapeGeometry} from '@sb/lib/graph/annotation-geometry';
import {Position} from '@sb/types/types';

import './line-handles.sass';

export type LineEnd = 'start' | 'end';

interface LineHandlesProps {
  layerItems: LayerItem[];
  onPointerDown: (shapeId: string, end: LineEnd, event: MouseEvent) => void;
}

/**
 * A handle at each end of the line that is selected alone. They are placed in
 * the overlay of the graph, so they move with it in the same frame, and keep
 * their size on screen whatever the zoom.
 */
const LineHandles = observer((props: LineHandlesProps) => {
  const graphSelection = useGraphSelection();

  const item = props.layerItems.find(
    item => item.id === graphSelection.transformTargetId,
  );
  if (item?.kind !== 'shape' || item.shape.annotation.shapeType !== 'line') {
    return null;
  }

  const geometry =
    graphSelection.shapePreviews.get(item.id) ??
    shapeGeometry(item.shape.annotation);
  const ends: [LineEnd, Position][] = [
    ['start', geometry.position],
    ['end', geometry.endPosition ?? geometry.position],
  ];

  return (
    <>
      {ends.map(([end, position]) => (
        <span
          key={end}
          className="sb-line-handle"
          style={
            {
              '--sb-line-handle-x': `${position.x}px`,
              '--sb-line-handle-y': `${position.y}px`,
            } as CSSProperties
          }
          onMouseDown={event => {
            if (event.button !== 0) return;
            props.onPointerDown(item.id, end, event);
          }}
        />
      ))}
    </>
  );
});

export default LineHandles;
