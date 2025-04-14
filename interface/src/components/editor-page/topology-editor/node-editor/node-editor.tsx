import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import cytoscape from 'cytoscape';
import {observer} from 'mobx-react-lite';
import {MenuItem} from 'primereact/menuitem';
import type {EventObject} from 'cytoscape';
import {SpeedDial} from 'primereact/speeddial';
import CytoscapeComponent from 'react-cytoscapejs';
import {ContextMenu} from 'primereact/contextmenu';

import NodeToolbar from './toolbar/node-toolbar';
import {Topology} from '@sb/types/domain/topology';
import {drawGrid, generateGraph} from '@sb/lib/utils/utils';
import {useSimulationConfig} from './state/simulation-config';
import SimulationPanel from './simulation-panel/simulation-panel';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';

import 'vis-network/styles/vis-network.css';
import './node-editor.sass';

interface NodeEditorProps {
  openTopology: Topology | null;

  onEditNode: (nodeName: string) => void;
  onAddNode: () => void;
}

const NodeEditor: React.FC<NodeEditorProps> = observer(
  (props: NodeEditorProps) => {
    const cyRef = useRef<cytoscape.Core | null>(null);
    const [contextMenuModel, setContextMenuModel] = useState<MenuItem[] | null>(
      null
    );
    const [radialMenuTarget, setRadialMenuTarget] = useState<string | null>(
      null
    );
    const ghostNodeId = 'ghost-target';
    const ghostEdgeId = 'ghost-edge';
    const deviceStore = useDeviceStore();
    const topologyStore = useTopologyStore();
    const simulationConfig = useSimulationConfig();
    const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<ContextMenu | null>(null);
    const radialMenuRef = useRef<SpeedDial>(null);
    const menuTargetRef = useRef<string | null>(null);

    const [nodeConnectTarget, setNodeConnectTarget] = useState<string | null>(
      null
    );
    const [nodeConnectTargetPosition, setNodeConnectTargetPosition] = useState<{
      x: number;
      y: number;
    } | null>(null);

    const [nodeConnectDestination, setNodeConnectDestination] = useState<
      string | null
    >(null);

    function drawGridOverlay(cy: cytoscape.Core) {
      const canvas = gridCanvasRef.current;
      if (!canvas || !containerRef.current) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const resizeCanvas = () => {
        canvas.width = containerRef.current!.clientWidth;
        canvas.height = containerRef.current!.clientHeight;
      };

      const draw = () => {
        resizeCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid(ctx, cy.zoom(), cy.pan());
      };

      cy.on('render zoom pan', draw);
      window.addEventListener('resize', draw);

      draw();

      return () => {
        cy.off('render zoom pan', draw);
        window.removeEventListener('resize', draw);
      };
    }

    const elements = useMemo(() => {
      if (props.openTopology === null) return [];
      return generateGraph(
        props.openTopology,
        deviceStore,
        topologyStore.manager
      );
    }, [deviceStore, props.openTopology, topologyStore.manager]);

    const onKeyDown = useCallback((event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        exitConnectionMode();
      }
    }, []);

    function onMouseMove(event: MouseEvent<HTMLDivElement>) {
      if (!cyRef.current || !nodeConnectTarget) return;

      const cy = cyRef.current as cytoscape.Core & {
        renderer: () => {
          projectIntoViewport: (x: number, y: number) => [number, number];
        };
      };

      const [x, y] = cy
        .renderer()
        .projectIntoViewport(event.clientX, event.clientY);

      drawConnectionLine(nodeConnectTarget, x, y);
    }

    function drawConnectionLine(
      sourceId: string,
      mouseX: number,
      mouseY: number
    ) {
      if (!cyRef.current) return;

      const cy = cyRef.current;

      const ghostNode = cy.getElementById(ghostNodeId);

      // Add ghost node and edge
      if (!ghostNode.nonempty()) {
        cy.add([
          {
            group: 'nodes',
            data: {id: ghostNodeId},
            position: {x: mouseX, y: mouseY},
            selectable: false,
            grabbable: false,
            classes: 'ghost-node',
          },
          {
            group: 'edges',
            data: {
              id: ghostEdgeId,
              source: sourceId,
              target: ghostNodeId,
              temp: true,
            },
            classes: 'ghost-edge',
          },
        ]);
      } else {
        ghostNode.position({x: mouseX, y: mouseY});
      }
    }

    /**
     * Wraps a network modifying function into a smooth move transition.
     *
     * @param callback The function that is called which modifies the network
     */
    const withSmoothTransition = useCallback((callback: () => void) => {
      const cy = cyRef.current;
      if (!cy) {
        callback();
        return;
      }

      const zoomBefore = cy.zoom();
      const panBefore = cy.pan();

      callback(); // modify elements or trigger re-layout

      const zoomAfter = cy.zoom();
      const panAfter = cy.pan();

      cy.zoom(zoomBefore).pan(panBefore);

      cy.animate(
        {
          zoom: zoomAfter,
          pan: panAfter,
        },
        {
          duration: 200,
          easing: 'ease-in-out',
        }
      );
    }, []);

    const onNodeConnect = useCallback(() => {
      const cy = cyRef.current;
      if (!cy || menuTargetRef.current === null) return;

      const nodeId = menuTargetRef.current;
      const node = cy.getElementById(nodeId);

      if (!node) return;

      setNodeConnectTarget(nodeId);
      setNodeConnectTargetPosition(node.position());
    }, []);

    const onNodeEdit = useCallback(() => {
      if (!cyRef.current || menuTargetRef.current === null) return;

      closeRadialMenu();
      props.onEditNode(menuTargetRef.current);
    }, [props]);

    const onNodeDelete = useCallback(() => {
      if (!cyRef || menuTargetRef.current === null) return;

      topologyStore.manager.deleteNode(menuTargetRef.current as string);
    }, [cyRef, topologyStore.manager]);

    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;

      const zoomBefore = cy.zoom();
      const panBefore = cy.pan();

      closeRadialMenu();

      cy.zoom(zoomBefore);
      cy.pan(panBefore);
    }, [elements]);

    useEffect(() => {
      window.addEventListener('keydown', onKeyDown);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
      };
    }, [onKeyDown]);

    const onNodeClick = useCallback(
      (event: cytoscape.EventObject) => {
        const nodeId = event.target.id();
        if (nodeConnectTarget && nodeConnectTarget !== nodeId) {
          topologyStore.manager.connectNodes(nodeConnectTarget, nodeId);
          exitConnectionMode();
          return;
        }

        if (radialMenuTarget !== null && radialMenuTarget !== nodeId) {
          closeRadialMenu();
          setTimeout(() => openRadialMenu(nodeId), 200);
        } else {
          openRadialMenu(nodeId);
        }

        setRadialMenuTarget(nodeId);
      },
      [nodeConnectTarget, radialMenuTarget]
    );

    const onBackgroundClick = useCallback((event: cytoscape.EventObject) => {
      if (event.target === cyRef.current) {
        exitConnectionMode();
        closeRadialMenu();
        cyRef.current?.elements().unselect();
      }
    }, []);

    function closeRadialMenu() {
      setRadialMenuTarget(null);
      radialMenuRef.current?.hide();
    }

    function openRadialMenu(targetNodeId: string) {
      if (!cyRef.current || !radialMenuRef.current || !containerRef.current)
        return;

      menuTargetRef.current = targetNodeId;

      const cy = cyRef.current;
      //const domRect = containerRef.current.getBoundingClientRect(); radial menu problems

      const pos = cy.getElementById(targetNodeId).renderedPosition();

      const element = radialMenuRef.current.getElement();
      element.style.position = 'absolute';
      element.style.top = `${pos.y - 32}px`;
      element.style.left = `${pos.x - 32}px`;
      radialMenuRef.current.show();
    }

    const onDoubleClick = useCallback(
      (event: cytoscape.EventObject) => {
        const nodeId = event.target.id();
        if (!nodeId || !contextMenuRef.current) return;

        event.target.select(); // show selected maybe remove
        closeRadialMenu();
        props.onEditNode(nodeId);
      },
      [props]
    );

    const onContext = useCallback(
      (event: cytoscape.EventObject) => {
        if (!contextMenuRef.current) return;

        const mouseEvent = event.originalEvent as unknown as MouseEvent;
        if (!mouseEvent) return;

        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();

        const isNode = event.target.isNode?.();
        const nodeId = isNode ? event.target.id() : null;

        if (isNode && nodeId) {
          setContextMenuModel(nodeContextMenuModel);
          menuTargetRef.current = nodeId;
        } else {
          setContextMenuModel(networkContextMenuModel);
          menuTargetRef.current = null;
        }

        contextMenuRef.current.show(mouseEvent);
      },
      [nodeConnectDestination]
    );

    const onDragging = useCallback(() => {
      closeRadialMenu();
      exitConnectionMode();
    }, []);

    const onDragStart = useCallback((event: cytoscape.EventObject) => {
      const node = event.target;
      if (!node || !node.isNode()) return;
    }, []);

    const onDragEnd = useCallback(
      (event: cytoscape.EventObject) => {
        const node = event.target;
        if (!node || !node.isNode()) return;

        const nodeId = node.id();
        const position = node.position();

        if (topologyStore.manager.topology) {
          topologyStore.manager.topology.positions.set(nodeId, {
            x: position.x,
            y: position.y,
          });
        }
      },
      [simulationConfig.liveSimulation, topologyStore.manager]
    );

    function onStabilizeGraph() {
      const cy = cyRef.current;
      if (!cy) return;

      cy.nodes().forEach(node => {
        node.unlock();
      });

      // TODO Phyisics (is only basic repulsion right now)
      const layout = cy.layout({
        name: 'cose',
        animate: true,
        animationDuration: 800,
      });

      simulationConfig.setIsStabilizing(true);

      layout.run();

      setTimeout(() => {
        cy.nodes().forEach(node => {
          if (!simulationConfig.liveSimulation) {
            node.lock();
          }
        });

        simulationConfig.setIsStabilizing(false);
      }, 800);
    }

    function onFitGraph() {
      if (!cyRef.current) return;
      withSmoothTransition(() => cyRef.current!.fit());
    }

    function onSaveGraph() {
      const cy = cyRef.current;
      if (!cy || !topologyStore.manager.topology) return;

      cy.nodes().forEach(node => {
        const id = node.id();
        const position = node.position();

        topologyStore.manager.topology?.positions.set(id, {
          x: Number(position.x.toFixed(2)),
          y: Number(position.y.toFixed(2)),
        });
      });
      topologyStore.manager.writePositions();
    }

    function exitConnectionMode() {
      setNodeConnectTarget(null);
      setNodeConnectDestination(null);
      setNodeConnectTargetPosition(null);
      if (cyRef.current) {
        cyRef.current.remove('.ghost-node');
        cyRef.current.remove('.ghost-edge');
      }
    }

    const nodeContextMenuModel = [
      {
        label: 'Connect',
        icon: 'pi pi-arrow-right-arrow-left',
        command: onNodeConnect,
      },
      {label: 'Edit', icon: 'pi pi-pen-to-square', command: onNodeEdit},
      {label: 'Delete', icon: 'pi pi-trash', command: onNodeDelete},
    ];

    const networkContextMenuModel = [
      {
        label: 'Add Node',
        icon: 'pi pi-plus',
        command: props.onAddNode,
      },
    ];

    const nodeRadialMenuModel = [
      {
        label: 'Connect',
        icon: 'pi pi-arrow-right-arrow-left',
        command: onNodeConnect,
      },
      {
        label: 'Edit',
        icon: 'pi pi-pen-to-square',
        command: onNodeEdit,
      },
      {
        label: 'Delete',
        icon: 'pi pi-trash',
        command: onNodeDelete,
      },
    ];

    const topologyStyle = [
      {
        selector: 'node',
        style: {
          'background-fit': 'cover',
          'background-image': 'data(image)',
          'background-color': '#1f1f1f',
          label: 'data(label)',
          color: '#fff',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'font-size': 7,
          'text-margin-y': 5,
        },
      },
      {
        selector: '.ghost-node',
        style: {
          width: 1,
          height: 1,
          'background-opacity': 0,
          'border-opacity': 0,
          label: '',
          opacity: 0,
          events: 'no',
        },
      },
      {
        selector: '.ghost-edge',
        style: {
          'line-style': 'dashed',
          'line-color': '#aaa',
          width: 2,
        },
      },
      {
        selector: 'edge',
        style: {
          'line-color': '#888',
          'target-arrow-color': '#888',
          width: 2,
          'curve-style': 'bezier',
        },
      },
    ];

    return (
      <div
        className="sb-node-editor"
        ref={containerRef}
        onMouseMove={onMouseMove}
      >
        <div className="graph-container">
          <canvas ref={gridCanvasRef} className="grid-canvas" />
          <CytoscapeComponent
            className="cytoscape-container"
            elements={elements}
            style={{width: '100%', height: '100%'}}
            layout={{name: 'preset'}}
            cy={(cy: cytoscape.Core) => {
              cyRef.current = cy;
              drawGridOverlay(cy);
              cy.off('tap', 'node');
              cy.off('dbltap', 'node');
              cy.off('cxttap', 'node');
              cy.off('grab', 'node');
              cy.off('drag', 'node');
              cy.off('free', 'node');
              cy.off('tap');
              cy.on('tap', 'node', onNodeClick);
              cy.on('dbltap', 'node', onDoubleClick);
              cy.on('cxttap', 'node', onContext);
              cy.on('grab', 'node', onDragStart);
              cy.on('drag', 'node', onDragging);
              cy.on('free', 'node', onDragEnd);
              cy.on('tap', (event: EventObject) => {
                if (event.target === cyRef.current) {
                  onBackgroundClick(event);
                }
              });
              cy.style().fromJson(topologyStyle).update();
            }}
          />
        </div>
        <NodeToolbar
          onAddNode={props.onAddNode}
          onFitGraph={onFitGraph}
          onSaveGraph={onSaveGraph}
          onToggleStabilization={simulationConfig.togglePanel}
        />
        <SimulationPanel onStabilizeGraph={onStabilizeGraph} />
        <SpeedDial
          className="sb-node-editor-dial"
          ref={radialMenuRef}
          model={nodeRadialMenuModel}
          radius={80}
          type="circle"
          visible={true}
          hideOnClickOutside={false}
          buttonClassName="p-button-warning"
        />
        <ContextMenu
          model={contextMenuModel ?? undefined}
          ref={contextMenuRef}
        />
      </div>
    );
  }
);

export default NodeEditor;
