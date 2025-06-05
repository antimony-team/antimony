import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {topologyStyle} from '@sb/lib/cytoscape-styles';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';

import './node-editor.sass';
import {convertXYToLatLng, drawGrid, generateGraph} from '@sb/lib/utils/utils';
import {Topology} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';
import type {EventObject} from 'cytoscape';
import cytoscape, {NodeSingular} from 'cytoscape';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error This library does not have a type declaration
import coseBilkent from 'cytoscape-cose-bilkent';
import {observer} from 'mobx-react-lite';
import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';
import {SpeedDial} from 'primereact/speeddial';
import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import {isMap} from 'yaml';
import SimulationPanel from './simulation-panel/simulation-panel';
import {useSimulationConfig} from './state/simulation-config';

import NodeToolbar from './toolbar/node-toolbar';

cytoscape.use(coseBilkent);

interface NodeEditorProps {
  openTopology: Topology | null;

  onEditNode: (nodeName: string) => void;
  onAddNode: () => void;
}

const GHOST_NODE_ID = 'ghost-target';
const GHOST_EDGE_ID = 'ghost-edge';

const NodeEditor: React.FC<NodeEditorProps> = observer(
  (props: NodeEditorProps) => {
    const [contextMenuModel, setContextMenuModel] = useState<MenuItem[] | null>(
      null
    );

    const [newCompoundGroup, setNewCompoundGroup] = useState<boolean>(false);
    const [isCyReady, setIsCyReady] = useState<boolean>(false);
    const [newGroupLabel, setNewGroupLabel] = useState<string>('');

    const drawStartPos = useRef<Position | null>(null);
    const drawEndPos = useRef<Position | null>(null);
    const isDrawingShape = useRef<boolean>(false);

    // const [drawStartPos, setDrawStartPos] = useState<{
    //   x: number;
    //   y: number;
    // } | null>(null);
    // const [drawEndPos, setDrawEndPos] = useState<{
    //   x: number;
    //   y: number;
    // } | null>(null);
    // const [isDrawingShape, setIsDrawingShape] = useState(false);

    const deviceStore = useDeviceStore();
    const topologyStore = useTopologyStore();
    const simulationConfig = useSimulationConfig();

    const radialMenuTarget = useRef<string | null>(null);
    const nodeConnectTarget = useRef<string | null>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);
    const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<ContextMenu | null>(null);
    const radialMenuRef = useRef<SpeedDial>(null);
    const menuTargetRef = useRef<string | null>(null);

    function drawGridOverlay(event: cytoscape.EventObject) {
      const canvas = gridCanvasRef.current;

      if (!canvas || !containerRef.current || !event.cy) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = containerRef.current!.clientWidth;
      canvas.height = containerRef.current!.clientHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawGrid(ctx, event.cy.zoom(), event.cy.pan());
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
      if (!cyRef.current || !nodeConnectTarget.current) return;

      const cy = cyRef.current as cytoscape.Core & {
        renderer: () => {
          projectIntoViewport: (x: number, y: number) => [number, number];
        };
      };

      const [x, y] = cy
        .renderer()
        .projectIntoViewport(event.clientX, event.clientY);

      drawConnectionLine(nodeConnectTarget.current, x, y);
    }

    function drawConnectionLine(
      sourceId: string,
      mouseX: number,
      mouseY: number
    ) {
      if (!cyRef.current) return;

      const cy = cyRef.current;

      const ghostNode = cy.getElementById(GHOST_NODE_ID);

      // Add ghost node and edge
      if (!ghostNode.nonempty()) {
        cy.add([
          {
            group: 'nodes',
            data: {id: GHOST_NODE_ID},
            position: {x: mouseX, y: mouseY},
            selectable: false,
            grabbable: false,
            classes: 'ghost-node',
          },
          {
            group: 'edges',
            data: {
              id: GHOST_EDGE_ID,
              source: sourceId,
              target: GHOST_NODE_ID,
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
      console.log('node connect 1');

      const cy = cyRef.current;
      if (!cy || menuTargetRef.current === null) return;

      const nodeId = menuTargetRef.current;
      const node = cy.getElementById(nodeId);

      console.log('node connect 2, node:', node);

      if (!node) return;

      nodeConnectTarget.current = nodeId;

      // setNodeConnectTarget(nodeId);
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

    const onEdgeClick = useCallback((event: cytoscape.EventObject) => {
      if (event.target.hasClass('ghost-edge')) {
        exitConnectionMode();
        closeRadialMenu();
        cyRef.current?.elements().unselect();
        closeGroupDeleteBtn();
      }
    }, []);

    const onNodeClick = useCallback((event: cytoscape.EventObject) => {
      if (!cyRef.current) return;

      const cy = cyRef.current;
      const node = event.target;
      const nodeId = node.id();

      if (node.hasClass('ghost-node')) {
        exitConnectionMode();
        closeRadialMenu();
        cyRef.current?.elements().unselect();
        closeGroupDeleteBtn();
        return;
      }

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

      console.log('connect target, node connect', nodeConnectTarget);
      if (nodeConnectTarget.current && nodeConnectTarget !== nodeId) {
        console.log('connect target');
        topologyStore.manager.connectNodes(nodeConnectTarget.current, nodeId);
        exitConnectionMode();
        return;
      }

      if (radialMenuTarget.current && radialMenuTarget.current !== nodeId) {
        closeRadialMenu();
        setTimeout(() => openRadialMenu(nodeId), 200);
      } else {
        openRadialMenu(nodeId);
      }

      radialMenuTarget.current = nodeId;
      // setRadialMenuTarget(nodeId);
    }, []);

    const onBackgroundClick = useCallback(() => {
      closeRadialMenu();
      cyRef.current?.elements().unselect();
      closeGroupDeleteBtn();
    }, []);

    function closeRadialMenu() {
      // radialMenuTarget = null;
      // setRadialMenuTarget(null);
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

    const onEdgeContext = useCallback((event: cytoscape.EventObject) => {
      if (event.target.hasClass('ghost-edge')) {
        exitConnectionMode();
      }
    }, []);

    const onNodeContext = useCallback((event: cytoscape.EventObject) => {
      exitConnectionMode();

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
    }, []);

    const onDragging = useCallback(() => {
      closeRadialMenu();
      exitConnectionMode();
      closeGroupDeleteBtn();
    }, []);

    const onDragStart = useCallback((event: cytoscape.EventObject) => {
      console.log('drag start');

      const node = event.target;
      if (!node || !node.isNode()) return;
    }, []);

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

      if (!cy || !topology?.definition) return;

      const updatedLabelMap = new Map<
        string,
        Record<string, string | number>
      >();

      for (const node of cy.nodes('.topology-node')) {
        const id = node.id();
        const pos = node.position();
        const position = {
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
        };
        const geo = convertXYToLatLng(position.x, position.y);

        const existingLabels = topology.definition.getIn([
          'topology',
          'nodes',
          id,
          'labels',
        ]);

        const useGeoCoords =
          isMap(existingLabels) &&
          (existingLabels.get('graph-geoCoordinateLat') ||
            existingLabels.get('graph-geoCoordinateLng'));

        const updatedLabels: Record<string, string | number> = {};

        updatedLabels['graph-group'] = node.parent().data('label') ?? null;

        if (useGeoCoords) {
          updatedLabels['graph-geoCoordinateLat'] = geo.lat.toString();
          updatedLabels['graph-geoCoordinateLng'] = geo.lng.toString();
        } else {
          updatedLabels['graph-posX'] = position.x;
          updatedLabels['graph-posY'] = position.y;
        }

        updatedLabelMap.set(id, updatedLabels);
      }

      topologyStore.manager.updateNodeLabels(updatedLabelMap);
    }

    function exitConnectionMode() {
      nodeConnectTarget.current = null;

      if (cyRef.current) {
        cyRef.current.remove('.ghost-node');
        cyRef.current.remove('.ghost-edge');
      }
    }

    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;

      const handleMouseDown = (e: EventObject) => {
        if (!isDrawingShape.current || e.target !== cy) return;
        drawStartPos.current = e.position;
        drawEndPos.current = e.position;
        // setDrawStartPos(e.position);
        // setDrawEndPos(e.position);
      };

      const handleMouseMove = (e: EventObject) => {
        if (!isDrawingShape.current || !drawStartPos) return;
        // setDrawEndPos(e.position);
        drawEndPos.current = e.position;
      };

      const handleMouseUp = () => {
        console.log('mouse up');

        if (
          !cyRef.current ||
          !isDrawingShape.current ||
          !drawStartPos.current ||
          !drawEndPos.current
        ) {
          return;
        }

        const cy = cyRef.current;

        const x = Math.min(drawStartPos.current.x, drawEndPos.current.x);
        const y = Math.min(drawStartPos.current.y, drawEndPos.current.y);
        const w = Math.abs(drawEndPos.current.x - drawStartPos.current.x);
        const h = Math.abs(drawEndPos.current.y - drawStartPos.current.y);

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

        const selectedParents = new Set<string>();
        hitsArray.forEach(n => {
          const parent = n.parent();
          if (parent && parent.nonempty()) {
            selectedParents.add(parent[0].id());
          }
        });

        let newGroupParent: string | undefined = undefined;
        if (selectedParents.size === 1) {
          newGroupParent = [...selectedParents][0];
        }
        console.log(
          'parebnt',
          newGroupParent,
          'selectedParent',
          selectedParents,
          'label',
          newGroupLabel
        );
        const groupId = `${newGroupLabel}1`;
        if (groupableIds.length) {
          cy.batch(() => {
            cy.add({
              group: 'nodes',
              data: {
                id: groupId,
                label: newGroupLabel,
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

        drawStartPos.current = null;
        drawEndPos.current = null;
        isDrawingShape.current = false;

        // setDrawStartPos(null);
        // setDrawEndPos(null);
        // setIsDrawingShape(false);
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
    }, []);

    function onDrawGroup() {
      setNewCompoundGroup(true);
      const cy = cyRef.current;
      if (!cy) return;

      cy.nodes('.drawn-shape').forEach(n => {
        n.style('events', 'no');
      });
      isDrawingShape.current = true;
      // setIsDrawingShape(true);
      cy.userPanningEnabled(false);
    }

    function applyNewGroupLabel() {
      if (!cyRef.current || !newCompoundGroup) return;
      setNewCompoundGroup(false);
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

    useEffect(() => {
      if (isCyReady && cyRef.current) {
        initCytoscape(cyRef.current);
      }
    }, [isCyReady]);

    function initCytoscape(cy: cytoscape.Core) {
      cy.minZoom(0.3);
      cy.maxZoom(10);
      cy.style().fromJson(topologyStyle).update();

      cy.on('click', (event: EventObject) => {
        if (event.target === cyRef.current) {
          onBackgroundClick();
        }
      });

      cy.on('click', 'node.compound-close-btn', handleCloseButtonTap);
      cy.on('click', 'node', onNodeClick);
      cy.on('dbltap', 'node', onDoubleClick);
      cy.on('cxttap', 'node', onNodeContext);
      cy.on('cxttap', 'edge', onEdgeContext);
      cy.on('grab', 'node', onDragStart);
      cy.on('drag', 'node', onDragging);
      cy.on('click', 'edge', onEdgeClick);
      cy.on('render', drawGridOverlay);

      onFitGraph();
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
              setIsCyReady(true);
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
          isOpen={newCompoundGroup}
          onClose={() => setNewCompoundGroup(false)}
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
