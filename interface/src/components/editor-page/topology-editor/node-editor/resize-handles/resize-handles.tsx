import React, {MouseEvent} from 'react';

import {observer} from 'mobx-react-lite';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {AnnotationItem} from '@sb/lib/graph/annotation-geometry';
import {Position} from '@sb/types/types';

import './resize-handles.sass';

// The handles by their side of the box, -1, 0 or 1 on each axis
const HANDLES: {direction: Position; cursor: string}[] = [
  {direction: {x: -1, y: -1}, cursor: 'nwse-resize'},
  {direction: {x: 0, y: -1}, cursor: 'ns-resize'},
  {direction: {x: 1, y: -1}, cursor: 'nesw-resize'},
  {direction: {x: -1, y: 0}, cursor: 'ew-resize'},
  {direction: {x: 1, y: 0}, cursor: 'ew-resize'},
  {direction: {x: -1, y: 1}, cursor: 'nesw-resize'},
  {direction: {x: 0, y: 1}, cursor: 'ns-resize'},
  {direction: {x: 1, y: 1}, cursor: 'nwse-resize'},
];

interface ResizeHandlesProps {
  items: AnnotationItem[];

  onPointerDown: (
    item: AnnotationItem,
    direction: Position,
    event: MouseEvent,
  ) => void;
}

/**
 * The frame and the handles to resize the group, shape or text that is
 * selected alone. They are placed in the overlay of the graph from the box of
 * the annotation, so they move with the graph in the same frame and are never
 * measured. Frame and handles keep their size on screen whatever the zoom.
 */
const ResizeHandles = observer((props: ResizeHandlesProps) => {
  const graphSelection = useGraphSelection();

  const item = props.items.find(
    item => item.id === graphSelection.transformTargetId,
  );
  const isLine =
    item?.kind === 'shape' && item.shape.annotation.shapeType === 'line';
  const box = item && !isLine ? graphSelection.annotationBox(item) : null;
  if (!item || !box) return null;

  return (
    <div
      className="sb-resize-handles"
      style={{left: box.x, top: box.y, width: box.width, height: box.height}}
    >
      <div className="sb-resize-handles-frame">
        {HANDLES.map(({direction, cursor}) => (
          <span
            key={`${direction.x}-${direction.y}`}
            className="sb-resize-handles-handle"
            style={{
              left: `${(direction.x + 1) * 50}%`,
              top: `${(direction.y + 1) * 50}%`,
              cursor,
            }}
            onMouseDown={event => {
              if (event.button !== 0) return;
              props.onPointerDown(item, direction, event);
            }}
          />
        ))}
      </div>
    </div>
  );
});

export default ResizeHandles;
