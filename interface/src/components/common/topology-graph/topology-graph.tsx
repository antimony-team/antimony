import React, {
  forwardRef,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import cytoscape, {ElementDefinition, EventObject} from 'cytoscape';
import CytoscapeComponent from 'react-cytoscapejs';

import {topologyStyle} from '@sb/lib/graph/cytoscape-styles';
import {
  fitGraph,
  updateGrid,
  updateLayerTransform,
} from '@sb/lib/graph/cytoscape-utils';

import './topology-graph.sass';

interface TopologyGraphProps {
  elements: ElementDefinition[];

  // The graph is fitted to its elements whenever this changes, e.g. when another topology is shown
  fitKey: string | null;

  isLocked?: boolean;

  // Event handlers by event and optional selector, e.g. "click" or "click node"
  events?: Record<string, (event: EventObject) => void>;

  // Called for every new cytoscape instance, the returned function is called when the instance is replaced
  onInstance?: (cy: cytoscape.Core) => (() => void) | void;

  // Content drawn behind and in front of the graph, positioned in graph coordinates
  underlay?: ReactNode;
  overlay?: ReactNode;
}

export interface TopologyGraphRef {
  fit: (animated: boolean) => void;
}

const NO_ELEMENTS: ElementDefinition[] = [];

/**
 * Brings the graph's elements in line with the given ones. Existing elements are updated in place, so an edit doesn't
 * redraw the whole graph. This is done manually instead of through the elements prop of the React Cytoscape library,
 * which removes the children of a removed parent. Here, new parents are added and nodes are moved to them before
 * anything is removed.
 */
function updateElements(cy: cytoscape.Core, elements: ElementDefinition[]) {
  const nextIds = new Set(elements.map(element => element.data.id!));
  const added: ElementDefinition[] = [];
  const updated: [cytoscape.SingularElementReturnValue, ElementDefinition][] =
    [];

  cy.batch(() => {
    for (const element of elements) {
      const existing = cy.getElementById(element.data.id!);

      if (existing.empty()) {
        added.push(element);
      } else if (
        existing.isEdge() &&
        (existing.data('source') !== element.data.source ||
          existing.data('target') !== element.data.target)
      ) {
        // The endpoints of an edge can't be changed in place
        existing.remove();
        added.push(element);
      } else {
        updated.push([existing, element]);
      }
    }

    // Parents have to exist before their children are added, and nodes before their edges
    cy.add(
      added.toSorted(
        (a, b) => elementOrder(a, nextIds) - elementOrder(b, nextIds),
      ),
    );

    for (const [existing, element] of updated) {
      if (existing.isNode()) {
        updateNode(existing, element);
      } else {
        updateData(existing, element);
      }
    }

    cy.elements()
      .filter(element => !nextIds.has(element.id()))
      .remove();
  });
}

function updateNode(node: cytoscape.NodeSingular, element: ElementDefinition) {
  const parent = element.data.parent ?? null;

  if ((node.parent().first().id() || null) !== parent) {
    node.move({parent});
  }

  const position = element.position;
  if (
    position &&
    (Math.abs(node.position('x') - position.x) > 0.01 ||
      Math.abs(node.position('y') - position.y) > 0.01)
  ) {
    node.position(position);
  }

  updateData(node, element);
}

function updateData(
  existing: cytoscape.NodeSingular | cytoscape.EdgeSingular,
  element: ElementDefinition,
) {
  for (const [key, value] of Object.entries(element.data)) {
    if (['id', 'parent', 'source', 'target'].includes(key)) continue;

    if (existing.data(key) !== value) {
      existing.data(key, value);
    }
  }
}

function elementOrder(element: ElementDefinition, ids: Set<string>) {
  if (element.data.source !== undefined) return 2;

  return element.data.parent && ids.has(element.data.parent) ? 1 : 0;
}

const LABEL_GAP = 8;

function labelAngle(edge: cytoscape.EdgeSingular): number {
  const s = edge.source().position();
  const t = edge.target().position();
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  if (dx === 0 && dy === 0) return 0;

  const angle = Math.atan(dy / dx);
  return dx === 0 && angle < 0 ? -angle : angle;
}

function syncLabelMargins(edge: cytoscape.EdgeSingular) {
  const angle = labelAngle(edge);
  edge.data({
    labelMarginX: Math.sin(angle) * LABEL_GAP,
    labelMarginY: -Math.cos(angle) * LABEL_GAP,
  });
}

export function bindEdgeLabelUpdates(cy: cytoscape.Core) {
  let pending = cy.collection();
  let frame = 0;

  const queue = (edges: cytoscape.EdgeCollection) => {
    pending = pending.union(edges);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      cy.batch(() =>
        pending.filter(edge => edge.inside()).forEach(syncLabelMargins),
      );
      pending = cy.collection();
      frame = 0;
    });
  };

  cy.on('position add', 'node', event => queue(event.target.connectedEdges()));
  cy.on('add', 'edge', event => queue(event.target));
  queue(cy.edges());
}

const TopologyGraph = forwardRef<TopologyGraphRef, TopologyGraphProps>(
  (props, ref) => {
    const cyRef = useRef<cytoscape.Core | null>(null);

    // Only a dependency for effects that have to run again for a new instance. Read the instance through cyRef.
    const [cyInstance, setCyInstance] = useState<cytoscape.Core | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const underlayRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    const fittedKey = useRef<string | null>(null);
    const isFitPending = useRef(false);

    // The handlers are registered once per instance, so they reach the latest props through these refs
    const eventsRef = useRef(props.events);
    eventsRef.current = props.events;

    const onInstanceRef = useRef(props.onInstance);
    onInstanceRef.current = props.onInstance;

    useImperativeHandle(ref, () => ({
      fit: (animated: boolean) => {
        if (cyRef.current) fitGraph(cyRef.current, animated);
      },
    }));

    useEffect(() => {
      if (!cyInstance) return;

      return onInstanceRef.current?.(cyInstance) ?? undefined;
    }, [cyInstance]);

    useEffect(() => {
      if (!cyInstance) return;

      updateElements(cyInstance, props.elements);

      if (props.fitKey !== null && props.fitKey !== fittedKey.current) {
        fittedKey.current = props.fitKey;
        fitWhenVisible(cyInstance);
      }
    }, [cyInstance, props.elements, props.fitKey]);

    /**
     * Cytoscape only measures its container again after a short delay, and a hidden graph has no size to fit to. A
     * hidden graph is fitted once cytoscape has resized it to a visible size.
     */
    function fitWhenVisible(cy: cytoscape.Core) {
      cy.resize();

      if (cy.width() === 0 || cy.height() === 0) {
        isFitPending.current = true;
        return;
      }

      isFitPending.current = false;
      fitGraph(cy, false);
    }

    function initCytoscape(cy: cytoscape.Core) {
      for (const key of Object.keys(eventsRef.current ?? {})) {
        const [event, selector] = key.split(' ');
        const handler = (e: EventObject) => eventsRef.current?.[key]?.(e);

        if (selector) {
          cy.on(event, selector, handler);
        } else {
          cy.on(event, handler);
        }
      }

      bindEdgeLabelUpdates(cy);

      cy.on('viewport', onViewport);
      cy.on('resize', onResize);

      updateViewport(cy);
    }

    function onViewport(event: EventObject) {
      updateViewport(event.cy);
    }

    function updateViewport(cy: cytoscape.Core) {
      if (containerRef.current) updateGrid(containerRef.current, cy);
      if (underlayRef.current) updateLayerTransform(underlayRef.current, cy);
      if (overlayRef.current) updateLayerTransform(overlayRef.current, cy);
    }

    // The graph has just been measured, measuring it again in fitWhenVisible would emit this event again
    function onResize(event: EventObject) {
      const cy = event.cy;
      if (!isFitPending.current || cy.width() === 0 || cy.height() === 0) {
        return;
      }

      isFitPending.current = false;
      fitGraph(cy, false);
    }

    return (
      <div className="sb-topology-graph" ref={containerRef}>
        <div className="sb-topology-graph-layer" ref={underlayRef}>
          {props.underlay}
        </div>
        <CytoscapeComponent
          className="cytoscape-container"
          stylesheet={topologyStyle}
          elements={NO_ELEMENTS}
          minZoom={0.1}
          maxZoom={10}
          autolock={props.isLocked}
          layout={{name: 'preset'}}
          cy={(cy: cytoscape.Core) => {
            // Called after every update, and StrictMode creates a second instance on mount
            if (cyRef.current === cy) return;

            cyRef.current = cy;
            fittedKey.current = null;
            initCytoscape(cy);
            setCyInstance(cy);
          }}
        />
        <div
          className="sb-topology-graph-layer sb-topology-graph-overlay"
          ref={overlayRef}
        >
          {props.overlay}
        </div>
      </div>
    );
  },
);

export default TopologyGraph;
