import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {Node, Position} from 'vis';
import Graph from 'react-graph-vis';
import {DataSet} from 'vis-data/peer';
import {observer} from 'mobx-react-lite';
import {IdType, Network} from 'vis-network';
import {MenuItem} from 'primereact/menuitem';
import {SpeedDial} from 'primereact/speeddial';
import {ContextMenu} from 'primereact/contextmenu';
import useResizeObserver from '@react-hook/resize-observer';
import {Data} from 'vis-network/declarations/network/Network';

import {NetworkOptions} from './network.conf';
import NodeToolbar from './toolbar/node-toolbar';
import {Topology} from '@sb/types/domain/topology';
import {drawGrid, generateGraph} from '@sb/lib/utils/utils';
import {useSimulationConfig} from './state/simulation-config';
import SimulationPanel from './simulation-panel/simulation-panel';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';

import 'vis-network/styles/vis-network.css';
import './node-editor.sass';
import {GraphNodeClickEvent} from '@sb/types/graph';

interface NodeEditorProps {
  openTopology: Topology | null;

  onEditNode: (nodeName: string) => void;
  onAddNode: () => void;
}

const NodeEditor: React.FC<NodeEditorProps> = observer(
  (props: NodeEditorProps) => {
    const [network, setNetwork] = useState<Network | null>(null);
    const [contextMenuModel, setContextMenuModel] = useState<MenuItem[] | null>(
      null
    );
    const [radialMenuTarget, setRadialMenuTarget] = useState<IdType | null>(
      null
    );

    const deviceStore = useDeviceStore();
    const topologyStore = useTopologyStore();
    const simulationConfig = useSimulationConfig();

    const containerRef = useRef(null);
    const contextMenuRef = useRef<ContextMenu | null>(null);
    const radialMenuRef = useRef<SpeedDial>(null);
    const networkCanvasContext = useRef<CanvasRenderingContext2D | null>(null);

    // Reference to the currently targeted node for the radial and context menu
    const menuTargetRef = useRef<IdType | null>(null);

    const [nodeConnectTarget, setNodeConnectTarget] = useState<IdType | null>(
      null
    );
    const [nodeConnectTargetPosition, setNodeConnectTargetPosition] =
      useState<Position | null>(null);

    const [nodeConnectDestination, setNodeConnectDestination] =
      useState<Position | null>(null);

    useResizeObserver(containerRef, () => {
      if (network) {
        network.redraw();
      }
    });

    const graphData: Data = useMemo(() => {
      if (!props.openTopology) {
        return {nodes: new DataSet(), edges: new DataSet()};
      }

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

    const drawConnectionLine = useCallback(
      (ctx: CanvasRenderingContext2D) => {
        if (
          !network ||
          !nodeConnectTargetPosition ||
          !nodeConnectDestination ||
          !containerRef.current
        ) {
          return;
        }

        const target = nodeConnectTargetPosition;
        const canvasRect = ctx.canvas.getBoundingClientRect();
        const destination = network.DOMtoCanvas({
          x: nodeConnectDestination.x - canvasRect.x,
          y: nodeConnectDestination.y - canvasRect.y,
        });

        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgb(66 181 172)';
        ctx.moveTo(target.x, target.y);
        ctx.lineTo(destination.x, destination.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(destination.x, destination.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      },
      [network, nodeConnectDestination, nodeConnectTargetPosition]
    );

    /**
     * Wraps a network modifying function into a smooth move transition.
     *
     * @param callback The function that is called which modifies the network
     */
    const withSmoothTrasition = useCallback(
      (callback: () => void) => {
        if (!network) {
          callback();
          return;
        }

        const positionBefore = network.getViewPosition();
        const scaleBefore = network.getScale();

        callback();

        const positionAfter = network.getViewPosition();
        const scaleAfter = network.getScale();

        network.moveTo({position: positionBefore, scale: scaleBefore});
        network.moveTo({
          position: positionAfter,
          scale: scaleAfter,
          animation: {
            duration: 200,
            easingFunction: 'easeOutQuad',
          },
        });
      },
      [network]
    );

    const onBeforeDrawing = useCallback(
      (ctx: CanvasRenderingContext2D) => {
        networkCanvasContext.current = ctx;

        drawGrid(ctx);
        drawConnectionLine(ctx);
      },
      [drawConnectionLine]
    );

    const onNodeConnect = useCallback(() => {
      if (!network || menuTargetRef.current === null) return;

      setNodeConnectTarget(menuTargetRef.current);
      setNodeConnectTargetPosition(
        network?.getPosition(menuTargetRef.current) ?? null
      );
    }, [network]);

    const onNodeEdit = useCallback(() => {
      if (!network || menuTargetRef.current === null) return;

      closeRadialMenu();
      props.onEditNode(menuTargetRef.current as string);
    }, [network, props]);

    const onNodeDelete = useCallback(() => {
      if (!network || menuTargetRef.current === null) return;

      topologyStore.manager.deleteNode(menuTargetRef.current as string);
    }, [network, topologyStore.manager]);

    const setNodesFixed = useCallback(
      (isFixed: boolean) => {
        const nodes = graphData.nodes as DataSet<Node>;
        nodes.forEach(node =>
          nodes.update({
            id: node.id,
            fixed: {x: isFixed, y: isFixed},
          })
        );
      },
      [graphData.nodes]
    );

    useEffect(() => {
      if (!network) return;

      const position = network.getViewPosition();
      const scale = network.getScale();
      closeRadialMenu();
      network.setData(graphData);
      network.moveTo({position, scale});
    }, [network, graphData, withSmoothTrasition]);

    useEffect(() => {
      window.addEventListener('keydown', onKeyDown);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
      };
    }, [onKeyDown]);

    useEffect(() => {
      if (!network || !simulationConfig.liveSimulation) return;

      network.setOptions({
        ...NetworkOptions,
        ...simulationConfig.config,
      });
    }, [network, simulationConfig.config, simulationConfig.liveSimulation]);

    useEffect(() => {
      if (!network) return;

      setNodesFixed(!simulationConfig.liveSimulation);
    }, [network, setNodesFixed, simulationConfig.liveSimulation]);

    useEffect(() => {
      network?.redraw();
    }, [network, nodeConnectTarget, nodeConnectDestination]);

    function onMouseMove(event: MouseEvent<HTMLDivElement>) {
      if (!nodeConnectTarget || !network) return;

      setNodeConnectDestination({x: event.clientX, y: event.clientY});
      network?.redraw();
    }

    function onClick(selectData: GraphNodeClickEvent) {
      if (!network) return;

      const targetNode = network?.getNodeAt(selectData.pointer.DOM);

      if (targetNode === undefined) {
        exitConnectionMode();
      }

      if (targetNode === undefined || targetNode === radialMenuTarget) {
        closeRadialMenu();
        network.unselectAll();
      } else if (targetNode !== undefined) {
        if (nodeConnectTarget !== null && nodeConnectDestination !== null) {
          topologyStore.manager.connectNodes(
            nodeConnectTarget as string,
            targetNode as string
          );
          exitConnectionMode();
          return;
        }

        if (radialMenuTarget !== null) {
          closeRadialMenu();
          setTimeout(() => {
            openRadialMenu(targetNode);
          }, 200);
        } else {
          openRadialMenu(targetNode);
        }
        setRadialMenuTarget(targetNode);
      }
    }

    function closeRadialMenu() {
      setRadialMenuTarget(null);
      radialMenuRef.current?.hide();
    }

    function openRadialMenu(targetNode: IdType) {
      if (!network || !radialMenuRef.current) return;

      menuTargetRef.current = targetNode;

      const targetPosition = network.getPosition(targetNode);
      const element = radialMenuRef.current?.getElement();

      element.style.top = `${network?.canvasToDOM(targetPosition).y - 32}px`;
      element.style.left = `${network?.canvasToDOM(targetPosition).x - 32}px`;
      radialMenuRef.current?.show();
    }

    function onDoubleClick(selectData: GraphNodeClickEvent) {
      if (!contextMenuRef.current) return;

      const targetNode = network?.getNodeAt(selectData.pointer.DOM);
      if (targetNode !== undefined) {
        network?.selectNodes([targetNode]);
        closeRadialMenu();
        onNodeEdit();
      }
    }

    function onContext(selectData: GraphNodeClickEvent) {
      if (!contextMenuRef.current) return;

      // If connection mode is currently active, exit and don't show menu
      if (nodeConnectDestination !== null) {
        exitConnectionMode();
        selectData.event.preventDefault();
        return;
      }

      const targetNode = network?.getNodeAt(selectData.pointer.DOM);

      if (targetNode !== undefined) {
        setContextMenuModel(nodeContextMenuModel);
        menuTargetRef.current = targetNode;
      } else {
        setContextMenuModel(networkContextMenuModel);
        menuTargetRef.current = null;
      }

      contextMenuRef.current.show(selectData.event);
    }

    function onDragging(event: GraphNodeClickEvent) {
      closeRadialMenu();

      if (event.nodes.length > 0) {
        exitConnectionMode();
      }
    }

    function onDragStart(event: GraphNodeClickEvent) {
      if (!event || !network || !graphData.nodes || event.nodes.length === 0)
        return;

      (graphData.nodes as DataSet<Node>).update({
        id: event.nodes[0],
        fixed: {x: false, y: false},
      });
    }

    function onDragEnd(event: GraphNodeClickEvent) {
      if (
        !network ||
        !topologyStore.manager.topology ||
        event.nodes.length === 0
      ) {
        return;
      }

      if (!simulationConfig.liveSimulation) {
        (graphData.nodes as DataSet<Node>).update({
          id: event.nodes[0],
          fixed: {
            x: true,
            y: true,
          },
        });
      }
    }

    function onStabilizeGraph() {
      if (!network) return;

      network.setOptions({
        ...NetworkOptions,
        ...simulationConfig.config,
        interaction: {
          dragNodes: false,
        },
      });

      const nodes = graphData.nodes as DataSet<Node>;
      nodes.forEach(node =>
        nodes.update({id: node.id, fixed: {x: false, y: false}})
      );

      simulationConfig.setIsStabilizing(true);

      setTimeout(() => {
        nodes.forEach(node =>
          nodes.update({
            id: node.id,
            fixed: {
              x: !simulationConfig.liveSimulation,
              y: !simulationConfig.liveSimulation,
            },
          })
        );
        simulationConfig.setIsStabilizing(false);
        network.setOptions({
          interaction: {
            dragNodes: true,
          },
        });
      }, 800);
    }

    function onFitGraph() {
      if (!network) return;

      withSmoothTrasition(() => network.fit());
    }

    function onSaveGraph() {
      if (!network) return;

      (graphData.nodes as DataSet<Node>).forEach(node => {
        if (!node.id) return;

        topologyStore.manager.topology?.positions.set(
          node.id as string,
          network.getPosition(node.id)
        );
      });

      topologyStore.manager.writePositions();
    }

    function exitConnectionMode() {
      setNodeConnectTarget(null);
      setNodeConnectDestination(null);
      setNodeConnectTargetPosition(null);
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

    return (
      <div
        className="sb-node-editor"
        ref={containerRef}
        onMouseMove={onMouseMove}
      >
        <Graph
          graph={{nodes: [], edges: []}}
          options={NetworkOptions}
          events={{
            beforeDrawing: onBeforeDrawing,
            click: onClick,
            doubleClick: onDoubleClick,
            oncontext: onContext,
            dragStart: onDragStart,
            dragging: onDragging,
            dragEnd: onDragEnd,
          }}
          getNetwork={setNetwork}
        />
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
