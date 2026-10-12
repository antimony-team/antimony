import React, {
  MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import cytoscape from 'cytoscape';
import {reaction} from 'mobx';
import {observer} from 'mobx-react-lite';
import Moveable from 'react-moveable';

import SelectionBar from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-bar';
import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  AnnotationItem,
  Box,
  GraphShape,
  GraphText,
  groupBoxAround,
  LayerItem,
  shapeBox,
  shapeGeometry,
  textBox,
  unionBox,
} from '@sb/lib/graph/annotation-geometry';
import {AnnotationStyle} from '@sb/lib/graph/annotation-style';
import {toRenderedBox} from '@sb/lib/graph/cytoscape-utils';
import {If} from '@sb/types/control';
import {FreeTextAnnotation} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

import './selection-overlay.sass';

// Distance between a resized group and its handles, so its border stays visible
const HANDLES_GAP = 4;

export type LineEnd = 'start' | 'end';

interface SelectionOverlayProps {
  getCy: () => cytoscape.Core | null;
  layerItems: LayerItem[];
  texts: GraphText[];

  onGroup: () => void;
  onStyle: (style: Partial<AnnotationStyle>) => void;
  onStylePreview: (style: Partial<AnnotationStyle> | null) => void;
  onResetStyle: (fields: (keyof AnnotationStyle)[]) => void;
  onTextStyle: (update: Partial<FreeTextAnnotation>) => void;
  onTextStylePreview: (update: Partial<FreeTextAnnotation> | null) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  // Called while a group or shape is resized and once more when it ends
  onResize: (id: string, box: Box, isFinal: boolean) => void;
  onLineEndPointerDown: (
    shapeId: string,
    end: LineEnd,
    event: MouseEvent,
  ) => void;
}

/**
 * The selection box, the bar below the selection and the handles of a selected
 * group or shape. They follow the selection and the viewport, so they are a
 * component of their own that renders without the rest of the editor.
 */
const SelectionOverlay = observer((props: SelectionOverlayProps) => {
  const graphSelection = useGraphSelection();

  const [moveableTarget, setMoveableTarget] = useState<HTMLElement | null>(
    null,
  );
  const moveableRef = useRef<Moveable>(null);
  const resizeStartBox = useRef<Box | null>(null);

  const cy = props.getCy();

  // Only followed while something is selected, so panning an empty selection renders nothing
  const viewportVersion =
    graphSelection.count > 0 ? graphSelection.viewportVersion : 0;
  const textItems = useMemo<AnnotationItem[]>(
    () => props.texts.map(text => ({kind: 'text', id: text.id, text})),
    [props.texts],
  );
  const items = [...props.layerItems, ...textItems];

  const selectedItems = items.filter(item =>
    graphSelection.annotationIds.includes(item.id),
  );
  const transformTarget =
    items.find(item => item.id === graphSelection.transformTargetId) ?? null;
  const transformedLine =
    transformTarget?.kind === 'shape' &&
    transformTarget.shape.annotation.shapeType === 'line'
      ? transformTarget.shape
      : null;
  const resized = transformedLine ? null : transformTarget;

  useLayoutEffect(() => {
    setMoveableTarget(
      resized
        ? (cy
            ?.container()
            ?.parentElement?.querySelector<HTMLElement>(
              `[data-layer-id="${CSS.escape(resized.id)}"]`,
            ) ?? null)
        : null,
    );
  }, [resized?.id, props.layerItems, props.texts]);

  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [viewportVersion, props.layerItems, props.texts]);

  // The handles follow a selected group or shape while it moves or changes
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

  function boxOf(item: AnnotationItem): Box | null {
    if (item.kind === 'text') {
      return textBox(
        {...item.text.annotation, ...graphSelection.textPreviews.get(item.id)},
        graphSelection.textSizes.get(item.id),
      );
    }

    if (item.kind === 'group') {
      return graphSelection.groupPreviews.get(item.id) ?? item.group;
    }

    return shapeBox(
      graphSelection.shapePreviews.get(item.id) ??
        shapeGeometry(item.shape.annotation),
    );
  }

  function barBox(): Box | null {
    if (!cy) return null;

    const boxes = selectedItems.map(boxOf).filter(box => box !== null);
    const selected = cy.$(':selected');

    if (selected.nonempty()) {
      const bounds = selected.boundingBox({});
      boxes.push({
        x: bounds.x1,
        y: bounds.y1,
        width: bounds.w,
        height: bounds.h,
      });
    }

    const box = unionBox(boxes);
    return box ? toRenderedBox(cy, box) : null;
  }

  const itemAlone =
    graphSelection.count === 1 && selectedItems.length === 1
      ? selectedItems[0]
      : null;
  const showBar =
    !graphSelection.isContextMenuOpen &&
    !graphSelection.isPointerDown &&
    !graphSelection.isInteracting &&
    !graphSelection.isHandActive &&
    !graphSelection.renamingGroupId &&
    (graphSelection.count > 1 || !!itemAlone);
  const box = showBar ? barBox() : null;

  const selectionBox = graphSelection.selectionBox;

  return (
    <>
      <If condition={selectionBox}>
        <div
          className="sb-selection-overlay-box"
          style={{
            left: selectionBox!.x,
            top: selectionBox!.y,
            width: selectionBox!.width,
            height: selectionBox!.height,
          }}
        />
      </If>
      <If condition={transformedLine}>
        <LineHandles
          line={transformedLine!}
          onPointerDown={props.onLineEndPointerDown}
        />
      </If>
      <SelectionBar
        box={box}
        item={itemAlone?.kind !== 'text' ? itemAlone : null}
        text={itemAlone?.kind === 'text' ? itemAlone.text : null}
        isEditingText={!!graphSelection.editingTextId}
        canGroup={graphSelection.nodeIds.length > 0}
        canReorder={selectedItems.length > 0}
        onGroup={props.onGroup}
        onStyle={props.onStyle}
        onStylePreview={props.onStylePreview}
        onResetStyle={props.onResetStyle}
        onTextStyle={props.onTextStyle}
        onTextStylePreview={props.onTextStylePreview}
        onBringToFront={props.onBringToFront}
        onSendToBack={props.onSendToBack}
        onUngroup={props.onUngroup}
        onDelete={props.onDelete}
      />
      {/*
       * Mounted for as long as the editor is, without a target while nothing can
       * be resized. Mounting adds the stylesheet of Moveable to the page and
       * unmounting removes it, which recalculates the styles of the whole page.
       */}
      <Moveable
        ref={moveableRef}
        className="sb-selection-overlay-moveable"
        target={moveableTarget}
        resizable
        snappable
        padding={HANDLES_GAP}
        keepRatio={false}
        origin={false}
        renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
        onResizeStart={event => {
          resizeStartBox.current = resized ? boxOf(resized) : null;
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
          props.onResize(
            resized.id,
            {
              x: start.x + dx,
              y: start.y + dy,
              width: event.width,
              height: event.height,
            },
            false,
          );
        }}
        onResizeEnd={event => {
          graphSelection.setInteracting(false);
          event.target.style.transform = '';

          const start = resizeStartBox.current;
          const last = event.lastEvent;
          if (!start || !last || !resized) return;

          const [dx, dy] = last.drag.beforeTranslate;
          props.onResize(
            resized.id,
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
    </>
  );
});

interface LineHandlesProps {
  line: GraphShape;
  onPointerDown: (shapeId: string, end: LineEnd, event: MouseEvent) => void;
}

// A handle at each end of the selected line, they follow the line while it changes
const LineHandles = observer((props: LineHandlesProps) => {
  const graphSelection = useGraphSelection();

  const geometry =
    graphSelection.shapePreviews.get(props.line.id) ??
    shapeGeometry(props.line.annotation);

  const {zoom, pan} = graphSelection;

  const ends: [LineEnd, Position][] = [
    ['start', geometry.position],
    ['end', geometry.endPosition ?? geometry.position],
  ];

  return (
    <>
      {ends.map(([end, position]) => (
        <span
          key={end}
          className="sb-selection-overlay-line-handle"
          style={{
            left: position.x * zoom + pan.x,
            top: position.y * zoom + pan.y,
          }}
          onMouseDown={event => {
            if (event.button !== 0) return;
            props.onPointerDown(props.line.id, end, event);
          }}
        />
      ))}
    </>
  );
});

export default SelectionOverlay;
