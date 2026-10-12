import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

import cytoscape from 'cytoscape';
import {observer} from 'mobx-react-lite';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  AnnotationItem,
  Box,
  growBox,
  nodeIconBox,
} from '@sb/lib/graph/annotation-geometry';
import {If} from '@sb/types/control';

import './selection-layer.sass';

// Distance between an element and its outline on screen
const OUTLINE_GAP = 4;
const LINE_WIDTH = 1.5;

export interface SelectionLayerRef {
  // Draws the outlines again, e.g. after the zoom or a selected node changed
  draw: () => void;
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
 */
const SelectionLayer = observer(
  forwardRef<SelectionLayerRef, SelectionLayerProps>((props, ref) => {
    const graphSelection = useGraphSelection();

    const nodePathRef = useRef<SVGPathElement>(null);
    const selectionBoxRef = useRef<SVGRectElement>(null);
    const outlineRefs = useRef(new Map<string, SVGRectElement>());

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
    };
    const stateRef = useRef(state);
    stateRef.current = state;

    function draw() {
      const cy = props.getCy();
      if (!cy) return;

      const pixel = 1 / cy.zoom();
      const gap = (OUTLINE_GAP + LINE_WIDTH / 2) * pixel;
      const {outlines, nodeIds, selectionBox} = stateRef.current;

      for (const outline of outlines) {
        const rect = outlineRefs.current.get(outline.id);
        if (rect) setRect(rect, growBox(outline.box, gap));
      }

      nodePathRef.current?.setAttribute(
        'd',
        nodeIds
          .map(nodeId => cy.getElementById(nodeId))
          .filter(node => node.nonempty())
          .map(node => rectPath(growBox(nodeIconBox(node.position()), gap)))
          .join(''),
      );

      if (selectionBoxRef.current && selectionBox) {
        setRect(
          selectionBoxRef.current,
          growBox(selectionBox, (LINE_WIDTH / 2) * pixel),
        );
      }
    }

    useLayoutEffect(draw);
    useImperativeHandle(ref, () => ({draw}));

    return (
      <svg className="sb-selection-layer" aria-hidden="true">
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
    );
  }),
);

function setRect(rect: SVGRectElement, box: Box) {
  rect.setAttribute('x', String(box.x));
  rect.setAttribute('y', String(box.y));
  rect.setAttribute('width', String(box.width));
  rect.setAttribute('height', String(box.height));
}

function rectPath(box: Box): string {
  return `M${box.x} ${box.y}h${box.width}v${box.height}h${-box.width}Z`;
}

export default SelectionLayer;
