import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import cytoscape from 'cytoscape';
import {reaction} from 'mobx';
import {observer} from 'mobx-react-lite';
import Moveable from 'react-moveable';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  AnnotationItem,
  Box,
  groupBoxAround,
} from '@sb/lib/graph/annotation-geometry';

import './moveable-handles.sass';

// The handles sit on the line of the outline of the selection, 4px away with half its 1.5px line
const HANDLES_GAP = 4.75;

export interface MoveableHandlesRef {
  // Measures the resized annotation again, e.g. when the graph is panned or zoomed
  updateRect: () => void;
}

interface MoveableHandlesProps {
  getCy: () => cytoscape.Core | null;
  items: AnnotationItem[];

  // Called while an annotation is resized and once more when it ends
  onResize: (item: AnnotationItem, box: Box, isFinal: boolean) => void;
}

/**
 * The handles to resize the group, shape or text that is selected alone.
 *
 * Moveable is mounted for as long as the editor is, without a target while
 * nothing can be resized. Mounting adds its stylesheet to the page and
 * unmounting removes it, which recalculates the styles of the whole page.
 */
const MoveableHandles = observer(
  forwardRef<MoveableHandlesRef, MoveableHandlesProps>((props, ref) => {
    const graphSelection = useGraphSelection();

    const [target, setTarget] = useState<HTMLElement | null>(null);
    const moveableRef = useRef<Moveable>(null);
    const resizeStartBox = useRef<Box | null>(null);

    const cy = props.getCy();

    const item =
      props.items.find(item => item.id === graphSelection.transformTargetId) ??
      null;
    const resized =
      item?.kind === 'shape' && item.shape.annotation.shapeType === 'line'
        ? null
        : item;

    useLayoutEffect(() => {
      setTarget(
        resized
          ? (cy
              ?.container()
              ?.parentElement?.querySelector<HTMLElement>(
                `[data-layer-id="${CSS.escape(resized.id)}"]`,
              ) ?? null)
          : null,
      );
    }, [resized?.id, props.items]);

    useEffect(() => {
      moveableRef.current?.updateRect();
    }, [props.items]);

    useImperativeHandle(ref, () => ({
      updateRect: () => moveableRef.current?.updateRect(),
    }));

    // The handles follow the selected annotation while it moves or changes
    useEffect(
      () =>
        reaction(
          () => [
            ...graphSelection.groupPreviews.values(),
            ...graphSelection.shapePreviews.values(),
            ...graphSelection.textPreviews.values(),
            ...graphSelection.textSizes.values(),
          ],
          () => requestAnimationFrame(() => moveableRef.current?.updateRect()),
        ),
      [],
    );

    return (
      <Moveable
        ref={moveableRef}
        className="sb-moveable-handles"
        target={target}
        resizable
        padding={HANDLES_GAP}
        keepRatio={false}
        origin={false}
        renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
        onResizeStart={event => {
          resizeStartBox.current = resized
            ? graphSelection.annotationBox(resized)
            : null;
          graphSelection.setInteracting(true);

          // A group with members can't get smaller than a group around one node
          if (resized?.kind === 'group' && resized.group.memberIds.length > 0) {
            const nodeGroup = groupBoxAround([{x: 0, y: 0}])!;
            event.setMin([nodeGroup.width, nodeGroup.height]);
          }
        }}
        onResize={event => {
          event.target.style.width = `${event.width}px`;
          event.target.style.height = `${event.height}px`;
          event.target.style.transform = event.drag.transform;

          const start = resizeStartBox.current;
          if (!start || !resized) return;

          const [dx, dy] = event.drag.beforeTranslate;
          const box = {
            x: start.x + dx,
            y: start.y + dy,
            width: event.width,
            height: event.height,
          };

          // Moveable changes the element directly, the outline of the selection follows this box
          graphSelection.setResizePreview({id: resized.id, box});
          props.onResize(resized, box, false);
        }}
        onResizeEnd={event => {
          graphSelection.setInteracting(false);
          graphSelection.setResizePreview(null);
          event.target.style.transform = '';

          const start = resizeStartBox.current;
          const last = event.lastEvent;
          if (!start || !last || !resized) return;

          const [dx, dy] = last.drag.beforeTranslate;
          props.onResize(
            resized,
            {
              x: start.x + dx,
              y: start.y + dy,
              width: last.width,
              height: last.height,
            },
            true,
          );
        }}
      />
    );
  }),
);

export default MoveableHandles;
