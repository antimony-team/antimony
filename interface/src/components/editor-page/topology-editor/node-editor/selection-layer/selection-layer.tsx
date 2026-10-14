import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

import classNames from 'classnames';
import cytoscape from 'cytoscape';
import {observer} from 'mobx-react-lite';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  AnnotationItem,
  Box,
  growBox,
  nodeIconBox,
  unionBox,
} from '@sb/lib/graph/annotation-geometry';
import {
  CONNECTION_SIDES,
  connectionArrow,
  ConnectionSide,
  sideNormal,
} from '@sb/lib/graph/connections';
import {SnapGuide} from '@sb/lib/graph/snapping';
import {If} from '@sb/types/control';

import './selection-layer.sass';

// Distance between an element and its outline on screen
const OUTLINE_GAP = 4;
const LINE_WIDTH = 1.5;

// Length on screen of the ticks at the ends of a gap guide, and their distance to the elements
const GAP_TICK = 12;
const GAP_INSET = 4;

// Radius on screen of a connection point, of the one a line end connects to, and of the gap around them
const POINT_RADIUS = 6;
const ACTIVE_POINT_RADIUS = 7.5;
const POINT_GAP = 2;

export interface SelectionLayerRef {
  // Draws the outlines again, e.g. after the zoom or a selected node changed
  draw: () => void;

  // The box around the whole selection that its handles resize
  frameBox: () => Box | null;
}

interface SelectionLayerProps {
  getCy: () => cytoscape.Core | null;
  items: AnnotationItem[];
}

interface Outline {
  id: string;
  box: Box;
}

/**
 * The outlines of all selected elements and the box drawn to select elements,
 * in a single SVG in the overlay of the graph. The nodes share one path, so a
 * large selection is still a single element.
 *
 * The gap to the elements keeps its size on screen, so the geometry depends on
 * the zoom. It is set by one function, after a render and whenever the zoom or
 * a selected node changes, so the outlines never lag behind the graph.
 *
 * The frame around a selection of several elements is placed the same way, it
 * is the target of the handles that resize the whole selection.
 */
const SelectionLayer = observer(
  forwardRef<SelectionLayerRef, SelectionLayerProps>((props, ref) => {
    const graphSelection = useGraphSelection();

    const nodePathRef = useRef<SVGPathElement>(null);
    const selectionBoxRef = useRef<SVGRectElement>(null);
    const connectionLineRef = useRef<SVGLineElement>(null);
    const outlineRefs = useRef(new Map<string, SVGRectElement>());
    const frameRef = useRef<HTMLDivElement>(null);
    const frameBox = useRef<Box | null>(null);

    const outlines: Outline[] = props.items
      .filter(
        item =>
          graphSelection.annotationIds.includes(item.id) &&
          !(
            item.kind === 'shape' && item.shape.annotation.shapeType === 'line'
          ),
      )
      .map(item => ({
        id: item.id,
        box:
          graphSelection.resizePreview?.id === item.id
            ? graphSelection.resizePreview.box
            : graphSelection.annotationBox(item),
      }))
      .filter((outline): outline is Outline => outline.box !== null);

    // Read during the render, so the layer renders again when they change
    const state = {
      outlines,
      nodeIds: graphSelection.nodeIds,
      selectionBox: graphSelection.selectionBox,
      connectionLine: graphSelection.connectionLine,
      isFrameShown: graphSelection.isSelectionTransformTarget,
      annotationsBox: graphSelection.isSelectionTransformTarget
        ? unionBox(
            props.items
              .filter(item => graphSelection.annotationIds.includes(item.id))
              .map(item => graphSelection.annotationBox(item))
              .filter(box => box !== null),
          )
        : null,
    };
    const stateRef = useRef(state);
    const arrows = graphSelection.connectionArrows;
    const connectionPoints = graphSelection.connectionPoints;
    stateRef.current = state;

    function draw() {
      const cy = props.getCy();
      if (!cy) return;

      const pixel = 1 / cy.zoom();
      const gap = (OUTLINE_GAP + LINE_WIDTH / 2) * pixel;
      const {outlines, nodeIds, selectionBox, isFrameShown, annotationsBox} =
        stateRef.current;
      const nodes = nodeIds
        .map(nodeId => cy.getElementById(nodeId))
        .filter(node => node.nonempty());

      for (const outline of outlines) {
        const rect = outlineRefs.current.get(outline.id);
        if (rect) setRect(rect, growBox(outline.box, gap));
      }

      nodePathRef.current?.setAttribute(
        'd',
        nodes
          .map(node => rectPath(growBox(nodeIconBox(node.position()), gap)))
          .join(''),
      );

      const connectionLine = stateRef.current.connectionLine;
      const source = connectionLine
        ? cy.getElementById(connectionLine.sourceId)
        : null;

      if (connectionLineRef.current && connectionLine && source?.nonempty()) {
        const line = connectionLineRef.current;
        line.setAttribute('x1', String(source.position().x));
        line.setAttribute('y1', String(source.position().y));
        line.setAttribute('x2', String(connectionLine.pointer.x));
        line.setAttribute('y2', String(connectionLine.pointer.y));
      }

      if (selectionBoxRef.current && selectionBox) {
        setRect(
          selectionBoxRef.current,
          growBox(selectionBox, (LINE_WIDTH / 2) * pixel),
        );
      }

      // Moveable changes the frame while the selection is resized
      if (frameRef.current && isFrameShown && !graphSelection.isInteracting) {
        frameBox.current = unionBox([
          ...(annotationsBox ? [annotationsBox] : []),
          ...nodes.map(node => nodeIconBox(node.position())),
        ]);
        if (frameBox.current) setFrame(frameRef.current, frameBox.current);
      }
    }

    useLayoutEffect(draw);
    useImperativeHandle(ref, () => ({
      draw,
      frameBox: () => (stateRef.current.isFrameShown ? frameBox.current : null),
    }));

    return (
      <>
        <div
          ref={frameRef}
          className="sb-selection-layer-frame"
          hidden={!state.isFrameShown}
        />
        <svg className="sb-selection-layer" aria-hidden="true">
          <If condition={state.connectionLine}>
            <line
              ref={connectionLineRef}
              className="sb-selection-layer-connection"
            />
          </If>
          {graphSelection.snapGuides.map(guide => (
            <path
              key={`${guide.axis}:${guide.kind}:${guide.value}:${guide.from}`}
              className={classNames('sb-selection-layer-guide', guide.kind)}
              d={guidePath(guide, graphSelection.zoom)}
            />
          ))}
          {arrows &&
            CONNECTION_SIDES.map(side => (
              <path
                key={side}
                className={classNames('sb-selection-layer-connection-arrow', {
                  active: arrows.active === side,
                })}
                d={arrowPath(arrows.box, side, graphSelection.zoom)}
              />
            ))}
          {connectionPoints?.points.map(point => {
            const active = connectionPoints.active;
            const isActive =
              active?.x === point.position.x && active.y === point.position.y;
            const radius =
              (isActive ? ACTIVE_POINT_RADIUS : POINT_RADIUS) /
              graphSelection.zoom;

            // A ring in the color of the graph separates the point from the border below it
            return (
              <g key={`${point.position.x}:${point.position.y}`}>
                <circle
                  className="sb-selection-layer-connection-gap"
                  cx={point.position.x}
                  cy={point.position.y}
                  r={radius + POINT_GAP / graphSelection.zoom}
                />
                <circle
                  className="sb-selection-layer-connection-point"
                  cx={point.position.x}
                  cy={point.position.y}
                  r={radius}
                  style={{
                    fill: isActive ? point.stroke : point.fill,
                    stroke: point.stroke,
                  }}
                />
              </g>
            );
          })}
          <If condition={state.selectionBox}>
            <rect ref={selectionBoxRef} className="sb-selection-layer-box" />
          </If>
          {outlines.map(outline => (
            <rect
              key={outline.id}
              ref={rect => {
                if (!rect) return;

                outlineRefs.current.set(outline.id, rect);
                return () => {
                  outlineRefs.current.delete(outline.id);
                };
              }}
              className="sb-selection-layer-outline"
            />
          ))}
          <path ref={nodePathRef} className="sb-selection-layer-outline" />
        </svg>
      </>
    );
  }),
);

function setRect(rect: SVGRectElement, box: Box) {
  rect.setAttribute('x', String(box.x));
  rect.setAttribute('y', String(box.y));
  rect.setAttribute('width', String(box.width));
  rect.setAttribute('height', String(box.height));
}

/*
 * An edge or center guide is a line across its axis, a gap guide a line along
 * its axis with a tick at each end.
 */
function guidePath(guide: SnapGuide, zoom: number) {
  const point = (along: number, across: number) =>
    guide.axis === 'x' ? `${along} ${across}` : `${across} ${along}`;
  const tick = GAP_TICK / 2 / zoom;

  if (guide.kind !== 'gap') {
    return guide.axis === 'x'
      ? `M${guide.value} ${guide.from}V${guide.to}`
      : `M${guide.from} ${guide.value}H${guide.to}`;
  }

  // In narrow gaps the ticks stay closer to the elements
  const inset = Math.min(GAP_INSET / zoom, (guide.to - guide.from) / 4);
  const from = guide.from + inset;
  const to = guide.to - inset;

  return [
    `M${point(from, guide.value - tick)}L${point(from, guide.value + tick)}`,
    `M${point(from, guide.value)}L${point(to, guide.value)}`,
    `M${point(to, guide.value - tick)}L${point(to, guide.value + tick)}`,
  ].join('');
}

/*
 * An arrow pointing away from the given side of a box, at the place where it
 * is pressed to draw a line from that side. Its size is in pixels on screen.
 */
function arrowPath(box: Box, side: ConnectionSide, zoom: number) {
  const center = connectionArrow(box, side, zoom);
  const normal = sideNormal(side);
  const point = (along: number, across: number) =>
    `${center.x + (normal.x * along - normal.y * across) / zoom} ${
      center.y + (normal.y * along + normal.x * across) / zoom
    }`;

  return `M${point(-13, -4.5)}L${point(2, -4.5)}L${point(2, -12)}L${point(14, 0)}L${point(2, 12)}L${point(2, 4.5)}L${point(-13, 4.5)}Z`;
}

function rectPath(box: Box): string {
  return `M${box.x} ${box.y}h${box.width}v${box.height}h${-box.width}Z`;
}

function setFrame(frame: HTMLDivElement, box: Box) {
  frame.style.left = `${box.x}px`;
  frame.style.top = `${box.y}px`;
  frame.style.width = `${box.width}px`;
  frame.style.height = `${box.height}px`;
}

export default SelectionLayer;
