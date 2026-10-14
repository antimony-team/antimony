import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import classNames from 'classnames';
import cytoscape from 'cytoscape';
import {reaction} from 'mobx';
import {observer} from 'mobx-react-lite';
import Moveable from 'react-moveable';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  AnnotationItem,
  Box,
  GraphGroup,
  Size,
} from '@sb/lib/graph/annotation-geometry';
import {SNAP_DISTANCE, snapResize, SnapTargets} from '@sb/lib/graph/snapping';

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

  // The box around a selection of several elements
  getSelectionBox: () => Box | null;

  // The smallest size of a group, or null if it can get as small as it likes
  getGroupMinSize: (group: GraphGroup) => Size | null;

  // What the resized annotation or the whole selection, without an item, snaps to
  getSnapTargets: (item: AnnotationItem | null) => SnapTargets | null;

  /*
   * Called while an annotation or the whole selection, without an item, is
   * resized from the start box and once more when it ends.
   */
  onResize: (
    item: AnnotationItem | null,
    startBox: Box,
    box: Box,
    isFinal: boolean,
  ) => void;
}

/**
 * The handles to resize the group, shape or text that is selected alone, or the
 * whole selection if several elements are selected.
 *
 * Moveable is mounted for as long as the editor is, without a target while
 * nothing can be resized. Mounting adds its stylesheet to the page and
 * unmounting removes it, which recalculates the styles of the whole page.
 */
const MoveableHandles = observer(
  forwardRef<MoveableHandlesRef, MoveableHandlesProps>((props, ref) => {
    const graphSelection = useGraphSelection();

    const [target, setTarget] = useState<HTMLElement | null>(null);
    const [keepRatio, setKeepRatio] = useState(false);
    const moveableRef = useRef<Moveable>(null);
    const resizeStartBox = useRef<Box | null>(null);
    const resizeDirection = useRef<[number, number]>([0, 0]);
    const resizeMinSize = useRef<Size | null>(null);
    const snapTargets = useRef<SnapTargets | null>(null);

    const cy = props.getCy();

    const item =
      props.items.find(item => item.id === graphSelection.transformTargetId) ??
      null;
    const resized =
      item?.kind === 'shape' && item.shape.annotation.shapeType === 'line'
        ? null
        : item;

    const isSelectionResized = graphSelection.isSelectionTransformTarget;

    useLayoutEffect(() => {
      const container = cy?.container()?.parentElement;

      if (isSelectionResized) {
        setTarget(
          container?.querySelector<HTMLElement>('.sb-selection-layer-frame') ??
            null,
        );
        return;
      }

      setTarget(
        resized
          ? (container?.querySelector<HTMLElement>(
              `[data-layer-id="${CSS.escape(resized.id)}"]`,
            ) ?? null)
          : null,
      );
    }, [resized?.id, isSelectionResized, props.items]);

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

    /*
     * Snaps the moved edges of the resized box to the other elements and the
     * grid, unless alt is held or the aspect ratio is kept. Only the size is
     * snapped, Moveable keeps the fixed side in place. A group doesn't snap
     * smaller than its members.
     */
    function snappedResizeSize(
      size: number[],
      fixedDirection: number[],
      inputEvent: MouseEvent | null,
    ): number[] {
      const start = resizeStartBox.current;
      const targets = snapTargets.current;
      if (!start || !targets || inputEvent?.altKey || inputEvent?.shiftKey) {
        graphSelection.setSnapGuides([]);
        return size;
      }

      const [width, height] = size;
      const snapped = snapResize(
        {
          x: start.x + ((fixedDirection[0] + 1) / 2) * (start.width - width),
          y: start.y + ((fixedDirection[1] + 1) / 2) * (start.height - height),
          width,
          height,
        },
        resizeDirection.current,
        !!(inputEvent?.ctrlKey || inputEvent?.metaKey),
        targets,
        SNAP_DISTANCE / (cy?.zoom() ?? 1),
      );
      const minSize = resizeMinSize.current;
      if (
        minSize &&
        (snapped.box.width < minSize.width ||
          snapped.box.height < minSize.height)
      ) {
        graphSelection.setSnapGuides([]);
        return size;
      }

      graphSelection.setSnapGuides(snapped.guides);
      return [snapped.box.width, snapped.box.height];
    }

    return (
      <Moveable
        ref={moveableRef}
        className={classNames('sb-moveable-handles', {
          selection: isSelectionResized,
        })}
        target={target}
        resizable
        throttleResize={0}
        useMutationObserver
        padding={HANDLES_GAP}
        keepRatio={keepRatio}
        origin={false}
        renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
        onResizeStart={event => {
          resizeStartBox.current = isSelectionResized
            ? props.getSelectionBox()
            : resized
              ? graphSelection.annotationBox(resized)
              : null;
          resizeDirection.current = event.direction as [number, number];
          snapTargets.current = props.getSnapTargets(
            isSelectionResized ? null : resized,
          );
          graphSelection.setInteracting(true);

          // A group can't get smaller than any of its members
          const minSize =
            !isSelectionResized && resized?.kind === 'group'
              ? props.getGroupMinSize(resized.group)
              : null;
          resizeMinSize.current = minSize;
          if (minSize) event.setMin([minSize.width, minSize.height]);
        }}
        onBeforeResize={event => {
          // Shift keeps the aspect ratio, ctrl resizes to all sides from the center
          const inputEvent = event.inputEvent as MouseEvent | null;
          setKeepRatio(!!inputEvent?.shiftKey);
          const fixedDirection =
            inputEvent?.ctrlKey || inputEvent?.metaKey
              ? [0, 0]
              : event.startFixedDirection;
          const size = event.setFixedDirection(fixedDirection);

          event.setSize(snappedResizeSize(size, fixedDirection, inputEvent));
        }}
        onResize={event => {
          const start = resizeStartBox.current;
          if (!start) return;

          const [dx, dy] = event.drag.beforeTranslate;
          const box = {
            x: start.x + dx,
            y: start.y + dy,
            width: event.width,
            height: event.height,
          };

          /*
           * The element is moved with left and top instead of a transform, so
           * the browser rounds both of its edges from where they are and the
           * edge that doesn't move stays on the same pixel.
           */
          setElementBox(event.target as HTMLElement, box);

          if (isSelectionResized) {
            props.onResize(null, start, box, false);
            return;
          }
          if (!resized) return;

          // Moveable changes the element directly, the outline of the selection follows this box
          graphSelection.setResizePreview({id: resized.id, box});
          props.onResize(resized, start, box, false);
        }}
        onResizeEnd={event => {
          setKeepRatio(false);
          graphSelection.setInteracting(false);
          graphSelection.setResizePreview(null);
          graphSelection.setSnapGuides([]);

          const start = resizeStartBox.current;
          const last = event.lastEvent;
          if (!start || !last || (!resized && !isSelectionResized)) return;

          // The element gets its box from the saved annotation again
          setElementBox(event.target as HTMLElement, start);

          const [dx, dy] = last.drag.beforeTranslate;
          props.onResize(
            isSelectionResized ? null : resized,
            start,
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

function setElementBox(element: HTMLElement, box: Box) {
  element.style.left = `${box.x}px`;
  element.style.top = `${box.y}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
}

export default MoveableHandles;
