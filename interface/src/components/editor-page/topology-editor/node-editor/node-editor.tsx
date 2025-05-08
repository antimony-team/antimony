import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import cytoscape, {NodeSingular} from 'cytoscape';
import {observer} from 'mobx-react-lite';
import {MenuItem} from 'primereact/menuitem';
import type {EventObject} from 'cytoscape';
import {SpeedDial} from 'primereact/speeddial';
import coseBilkent from 'cytoscape-cose-bilkent';
import CytoscapeComponent from 'react-cytoscapejs';
import {topologyStyle} from '@sb/lib/cytoscape-styles';
import {ContextMenu} from 'primereact/contextmenu';

import NodeToolbar from './toolbar/node-toolbar';
import {nodeData, Topology} from '@sb/types/domain/topology';
import {drawGrid, generateGraph} from '@sb/lib/utils/utils';
import {useSimulationConfig} from './state/simulation-config';
import SimulationPanel from './simulation-panel/simulation-panel';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';

import './node-editor.sass';
import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

cytoscape.use(coseBilkent);
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
    const [newCompoundGroup, setNewCompoundGroup] = useState<string | null>(
      null
    );
    const [cyReady, setCyReady] = useState<boolean>(false);
    const [newGroupLabel, setNewGroupLabel] = useState<string>('');
    const [drawStartPos, setDrawStartPos] = useState<{
      x: number;
      y: number;
    } | null>(null);
    const [drawEndPos, setDrawEndPos] = useState<{x: number; y: number} | null>(
      null
    );
    const [isDrawingShape, setIsDrawingShape] = useState(false);
    const [nodeConnectTarget, setNodeConnectTarget] = useState<string | null>(
      null
    );
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

    const onStabilizeGraph = () => {
      const cy = cyRef.current;
      if (!cy) return;
      if (cy.elements().empty()) return;

      const layout = cy.layout({
        ...simulationConfig.config,
      });

      simulationConfig.setIsStabilizing(true);
      layout.run();
      layout.promiseOn('layoutstop')?.then(() => {
        simulationConfig.setIsStabilizing(false);
      });
    };

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

    const onNodeConnect = useCallback(() => {
      const cy = cyRef.current;
      if (!cy || menuTargetRef.current === null) return;

      const nodeId = menuTargetRef.current;
      const node = cy.getElementById(nodeId);

      if (!node) return;

      setNodeConnectTarget(nodeId);
    }, []);

    const onNodeEdit = useCallback(() => {
      if (!cyRef.current || menuTargetRef.current === null) return;

      closeRadialMenu();
      props.onEditNode(menuTargetRef.current);
    }, [props]);

    const onNodeDelete = useCallback(() => {
      if (!menuTargetRef.current) return;

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

    function ungroupCompound(compoundId: string) {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const compound = cy.getElementById(compoundId);

      if (!compound.nonempty() || !compound.isParent()) {
        return;
      }

      const parentCol = compound.parent();
      const parentId = parentCol.nonempty()
        ? (parentCol.first() as NodeSingular).id()
        : null;

      compound.children().forEach(child => {
        (child as NodeSingular).move({parent: parentId});
      });
      cy.getElementById(CLOSE_ID(compoundId));
      compound.remove();
    }

    const handleCloseButtonTap = useCallback(
      (e: EventObject) => {
        const btnNode = e.target as NodeSingular;
        const closeId = btnNode.id();
        const compoundId = closeId.replace(/^close-/, '');

        ungroupCompound(compoundId);
        btnNode.remove();
      },
      [ungroupCompound]
    );

    const CLOSE_ID = (compoundId: string) => `close-${compoundId}`;

    function closeGroupDeleteBtn() {
      cyRef.current?.nodes('.compound-close-btn').style('visibility', 'hidden');
    }

    const onNodeClick = useCallback(
      (event: cytoscape.EventObject) => {
        if (!cyRef.current) return;
        const cy = cyRef.current;
        const node = event.target;
        const nodeId = node.id();
        closeGroupDeleteBtn();
        if (node.hasClass('compound-close-btn')) return;

        if (node.hasClass('drawn-shape')) {
          const closeBtnId = CLOSE_ID(nodeId);
          const closeBtn = cy.getElementById(closeBtnId);

          if (!node.nonempty() || !closeBtn.nonempty()) return;
          const bb = node.boundingBox();
          closeBtn.position({
            x: bb.x2 + 10,
            y: bb.y1 - 10,
          });
          cy.getElementById(closeBtnId).style('visibility', 'visible');
          return;
        }

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
        closeGroupDeleteBtn();
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
      const node = cy.getElementById(targetNodeId);
      const element = radialMenuRef.current.getElement();
      const updatePosition = () => {
        const zoom = cy.zoom();
        const pos = node.renderedPosition();
        element.style.position = 'absolute';
        element.style.left = `${pos.x}px`;
        element.style.top = `${pos.y}px`;

        element.style.transform = `translate(-50%, -50%) scale(${zoom})`;
        element.style.transformOrigin = 'center';
      };
      updatePosition();

      cy.on('pan zoom position', updatePosition);

      element.dataset.popperAttachedTo = targetNodeId;

      radialMenuRef.current.show();
    }

    const onDoubleClick = useCallback(
      (event: cytoscape.EventObject) => {
        if (event.target.hasClass('drawn-shape')) return;
        const nodeId = event.target.id();
        if (!nodeId || !contextMenuRef.current) return;

        closeRadialMenu();
        props.onEditNode(nodeId);
      },
      [props]
    );

    const onContext = useCallback(
      (event: cytoscape.EventObject) => {
        if (event.target.hasClass('drawn-shape')) return;
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
      closeGroupDeleteBtn();
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

    function onFitGraph() {
      const cy = cyRef.current;
      if (!cy) return;

      cy.animate(
        {
          fit: {
            eles: cy.elements(),
            padding: 100,
          },
        },
        {
          duration: 200,
          easing: 'ease-in-out',
        }
      );
    }

    function onSaveGraph() {
      const cy = cyRef.current;
      const topology = topologyStore.manager.topology;

      if (!cy || !topology) return;

      // Initialize metadata if needed
      if (!topology.metaData) {
        topology.metaData = {
          nodeData: new Map<string, nodeData>(),
          utilityNodes: [],
        };
      }

      topology.metaData.nodeData = new Map<string, nodeData>();
      topology.metaData.utilityNodes = [];

      cy.nodes().forEach(node => {
        const id = node.id();
        const pos = node.position();
        const position = {
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
        };
        const label = node.data('label') || undefined;

        const nodeInfo: nodeData = {
          id,
          position,
          label: label,
          class: node.classes().join(' '),
          parent: node.data('parent') ?? undefined,
        };

        if (node.hasClass('topology-node')) {
          topology.metaData.nodeData.set(id, nodeInfo);
        } else if (
          node.hasClass('drawn-shape') ||
          node.hasClass('compound-close-btn')
        ) {
          topology.metaData.utilityNodes.push(nodeInfo);
        }
      });
    }

    function exitConnectionMode() {
      setNodeConnectTarget(null);
      setNodeConnectDestination(null);
      if (cyRef.current) {
        cyRef.current.remove('.ghost-node');
        cyRef.current.remove('.ghost-edge');
      }
    }

    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;

      const handleMouseDown = (e: EventObject) => {
        if (!isDrawingShape || e.target !== cy) return;
        setDrawStartPos(e.position);
        setDrawEndPos(e.position);
      };

      const handleMouseMove = (e: EventObject) => {
        if (!isDrawingShape || !drawStartPos) return;
        setDrawEndPos(e.position);
      };

      const handleMouseUp = () => {
        const cy = cyRef.current;
        if (!cy || !isDrawingShape || !drawStartPos || !drawEndPos) return;

        const x = Math.min(drawStartPos.x, drawEndPos.x);
        const y = Math.min(drawStartPos.y, drawEndPos.y);
        const w = Math.abs(drawEndPos.x - drawStartPos.x);
        const h = Math.abs(drawEndPos.y - drawStartPos.y);

        const hitsArray = cy
          .nodes()
          .filter(n => {
            if (n.hasClass('compound-close-btn')) return false;
            const {x: nx, y: ny} = n.position();
            return nx >= x && nx <= x + w && ny >= y && ny <= y + h;
          })
          .toArray() as NodeSingular[];

        const hitsSet = new Set(hitsArray.map(n => n.id()));

        const compoundFullyHit = hitsArray
          .filter(n => n.isParent())
          .filter((compound: NodeSingular) => {
            return compound
              .descendants()
              .toArray()
              .every(desc => hitsSet.has(desc.id()));
          })
          .map(c => c.id());

        const partialCompounds = hitsArray
          .filter(n => n.isParent())
          .filter((compound: NodeSingular) => {
            const descs = compound.descendants().toArray();
            const hitCount = descs.filter(d => hitsSet.has(d.id())).length;
            return hitCount > 0 && hitCount < descs.length;
          });

        const newGroupParent = partialCompounds.length
          ? partialCompounds[0].id()
          : undefined;
        const groupableIds = hitsArray
          .map(n => n.id())
          .filter(id => {
            if (compoundFullyHit.includes(id)) {
              return true;
            }
            const node = cy.getElementById(id) as NodeSingular;
            return node
              .ancestors()
              .toArray()
              .every(anc => !compoundFullyHit.includes(anc.id()));
          });
        const groupId = `group-${Date.now()}`;
        if (groupableIds.length) {
          cy.batch(() => {
            cy.add({
              group: 'nodes',
              data: {
                id: groupId,
              },
              classes: 'drawn-shape',
            });
            groupableIds.forEach(id =>
              cy.getElementById(id).move({parent: groupId})
            );

            if (newGroupParent) {
              cy.getElementById(groupId).move({parent: newGroupParent});
            }
          });
        }
        cy.add({
          group: 'nodes',
          data: {id: CLOSE_ID(groupId)},
          position: {x: 0, y: 0},
          classes: 'compound-close-btn',
        });

        cy.nodes().unlock().grabify();
        cy.nodes('.drawn-shape').forEach(n => {
          n.style('events', 'yes');
        });

        setDrawStartPos(null);
        setDrawEndPos(null);
        setIsDrawingShape(false);
        setNewCompoundGroup(groupId);
        cy.userPanningEnabled(true);
      };

      cy.on('mousedown', handleMouseDown);
      cy.on('mousemove', handleMouseMove);
      cy.on('mouseup', handleMouseUp);

      return () => {
        cy.off('mousedown', handleMouseDown);
        cy.off('mousemove', handleMouseMove);
        cy.off('mouseup', handleMouseUp);
      };
    }, [isDrawingShape, drawStartPos, drawEndPos]);

    function onDrawGroup() {
      const cy = cyRef.current;
      if (!cy) return;

      cy.nodes('.drawn-shape').forEach(n => {
        n.style('events', 'no');
      });
      setIsDrawingShape(true);
      cy.userPanningEnabled(false);
    }

    function applyNewGroupLabel() {
      if (!cyRef.current || !newCompoundGroup) return;
      const cy = cyRef.current;
      const groupNode = cy.getElementById(newCompoundGroup);
      if (groupNode && groupNode.nonempty()) {
        groupNode.data('label', newGroupLabel);
      }
      setNewCompoundGroup(null);
    }

    useEffect(() => {
      if (cyReady) {
        cyRef.current?.fit(undefined, 100);
      }
    }, [cyReady]);

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

    function cytoscapeEventCalls(cy: cytoscape.Core) {
      cy.off('tap', 'node');
      cy.off('dbltap', 'node');
      cy.off('cxttap', 'node');
      cy.off('grab', 'node');
      cy.off('drag', 'node');
      cy.off('free', 'node');
      cy.off('tap');

      cy.on('tap', 'node.compound-close-btn', handleCloseButtonTap);
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
    }

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
            layout={{name: 'preset'}}
            cy={(cy: cytoscape.Core) => {
              cyRef.current = cy;
              drawGridOverlay(cy);
              cytoscapeEventCalls(cy);
              cy.style().fromJson(topologyStyle).update();
              setCyReady(true);
            }}
          />
        </div>
        <NodeToolbar
          onAddNode={props.onAddNode}
          onFitGraph={onFitGraph}
          onSaveGraph={onSaveGraph}
          onDrawGroup={onDrawGroup}
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
        <SBDialog
          isOpen={newCompoundGroup !== null}
          onClose={() => setNewCompoundGroup(null)}
          onSubmit={applyNewGroupLabel}
          headerTitle="Set Group Label"
        >
          <div className="p-fluid">
            <div className="p-field">
              <label htmlFor="groupLabel">Group Label</label>
              <input
                id="groupLabel"
                value={newGroupLabel}
                onChange={e => setNewGroupLabel(e.target.value)}
                className="p-inputtext p-component"
              />
            </div>
          </div>
        </SBDialog>
      </div>
    );
  }
);

export default NodeEditor;
