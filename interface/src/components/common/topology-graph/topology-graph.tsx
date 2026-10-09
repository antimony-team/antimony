import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import cytoscape, {ElementDefinition, EventObject} from 'cytoscape';
import CytoscapeComponent from 'react-cytoscapejs';

import {topologyStyle} from '@sb/lib/graph/cytoscape-styles';
import {drawGraphGrid, fitGraph} from '@sb/lib/graph/cytoscape-utils';

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
}

export interface TopologyGraphRef {
  fit: (animated: boolean) => void;
}

const NO_ELEMENTS: ElementDefinition[] = [];

const TopologyGraph = forwardRef<TopologyGraphRef, TopologyGraphProps>(
  (props, ref) => {
    const cyRef = useRef<cytoscape.Core | null>(null);

    // Only a dependency for effects that have to run again for a new instance. Read the instance through cyRef.
    const [cyInstance, setCyInstance] = useState<cytoscape.Core | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const gridCanvasRef = useRef<HTMLCanvasElement>(null);

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

    /*
     * The elements are replaced manually instead of through the elements prop of the React Cytoscape library, which
     * only adds and removes the changed elements. When a parent is removed that way, its children are removed too.
     */
    useEffect(() => {
      if (!cyInstance) return;

      cyInstance.batch(() => {
        cyInstance.elements().remove();
        cyInstance.add(props.elements);
      });

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

      cy.on('render', onRender);
      cy.on('resize', onResize);
    }

    function onRender(event: EventObject) {
      if (!containerRef.current || !gridCanvasRef.current) return;

      drawGraphGrid(containerRef.current, gridCanvasRef.current, event.cy);
    }

    function onResize(event: EventObject) {
      if (isFitPending.current) fitWhenVisible(event.cy);
    }

    return (
      <div className="sb-topology-graph" ref={containerRef}>
        <canvas ref={gridCanvasRef} className="grid-canvas" />
        <CytoscapeComponent
          className="cytoscape-container"
          stylesheet={topologyStyle}
          elements={NO_ELEMENTS}
          minZoom={0.3}
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
      </div>
    );
  },
);

export default TopologyGraph;
