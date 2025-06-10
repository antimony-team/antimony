import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {topologyStyle} from '@sb/lib/cytoscape-styles';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';

import './node-editor.sass';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {
  convertXYToLatLng,
  drawGraphGrid,
  generateGraph,
  getDistance,
} from '@sb/lib/utils/utils';
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
import React, {MouseEvent, useEffect, useMemo, useRef, useState} from 'react';
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

const GHOST_EDGE_ID = 'ghost-edge';
const GHOST_NODE_ID = 'ghost-node';

export interface GroupEditDialogState {
  groupName?: string;

  action: DialogAction;
}

const NodeEditor: React.FC<NodeEditorProps> = observer(
  (props: NodeEditorProps) => {
    const [contextMenuModel, setContextMenuModel] = useState<MenuItem[] | null>(
      null
    );
    const [isCyReady, setIsCyReady] = useState<boolean>(false);

    const groupNameDialogState = useDialogState<GroupEditDialogState>();

    const deviceStore = useDeviceStore();
    const topologyStore = useTopologyStore();
    const simulationConfig = useSimulationConfig();

    const cyRef = useRef<cytoscape.Core | null>(null);
    const radialMenuTarget = useRef<string | null>(null);
    const nodeConnectTarget = useRef<string | null>(null);
    const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<ContextMenu | null>(null);
    const radialMenuRef = useRef<SpeedDial>(null);
    const menuTargetRef = useRef<string | null>(null);
    const groupRenameInput = useRef<SBInputRef>(null);
    const drawStartPos = useRef<Position | null>(null);
    const drawEndPos = useRef<Position | null>(null);
    const isDrawModeOn = useRef<boolean>(false);

    /**
     * We have update graph elements manually instead of using the reactive
     * elements prop provided by the React Cytoscape library because the library
     * dynamically adds and removes elements when the element prop is updated.
     *
     * This makes it so, if a parent is deleted in the graph, its children
     * are also deleted. This is unwanted behavior.
     */
    useEffect(() => {
      if (props.openTopology === null || !cyRef.current) return;

      cyRef.current?.elements().remove();

      const elements = generateGraph(
        props.openTopology,
        deviceStore,
        topologyStore.manager
      );

      for (const element of elements) {
        cyRef.current.add(element);
      }

      if (lastOpenedTopology.current !== props.openTopology.id) {
        lastOpenedTopology.current = props.openTopology.id;
        onFitGraph();
      }
    }, [deviceStore, props.openTopology, topologyStore.manager]);

    const elements = useMemo(() => {
      if (props.openTopology === null) return [];

      return;
    }, []);

    useEffect(() => {
      window.addEventListener('keydown', onKeyDown);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
      };
    }, [onKeyDown]);

    useEffect(() => {
      if (!cyRef.current) return;

      const cy = cyRef.current;

      const zoomBefore = cy.zoom();
      const panBefore = cy.pan();

      closeRadialMenu();

      cy.zoom(zoomBefore);
      cy.pan(panBefore);
    }, [elements]);

    useEffect(() => {
      if (isCyReady && cyRef.current) {
        initCytoscape(cyRef.current);
      }
    }, [isCyReady]);

    function drawGridOverlay(event: cytoscape.EventObject) {
      if (!gridCanvasRef.current || !containerRef.current || !event.cy) return;

      drawGraphGrid(containerRef.current, gridCanvasRef.current, event.cy);
    }

    function onStabilizeGraph() {
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

      onSaveGraph();
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
            classes: GHOST_NODE_ID,
          },
          {
            group: 'edges',
            data: {
              id: GHOST_EDGE_ID,
              source: sourceId,
              target: GHOST_NODE_ID,
              temp: true,
            },
            classes: GHOST_EDGE_ID,
          },
        ]);
      } else {
        ghostNode.position({x: mouseX, y: mouseY});
      }
    }

    function onNodeConnect() {
      const cy = cyRef.current;
      if (!cy || menuTargetRef.current === null) return;

      const nodeId = menuTargetRef.current;
      const node = cy.getElementById(nodeId);

      if (!node) return;

      nodeConnectTarget.current = nodeId;
    }

    function onNodeEdit() {
      if (!cyRef.current || menuTargetRef.current === null) return;

      closeRadialMenu();
      props.onEditNode(menuTargetRef.current);
    }

    function onNodeDelete() {
      if (!menuTargetRef.current) return;

      topologyStore.manager.deleteNode(menuTargetRef.current as string);
    }

    function onEdgeDelete() {
      if (!menuTargetRef.current || !cyRef.current) return;

      const node1 = cyRef.current
        .getElementById(menuTargetRef.current)!
        .data('source');

      const node2 = cyRef.current
        .getElementById(menuTargetRef.current)!
        .data('target');

      topologyStore.manager.disconnectNodes(node1, node2);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        exitConnectionMode();
      }
    }

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

    function onGroupDelete(groupId: string) {
      if (!cyRef.current) return;

      const cy = cyRef.current;
      const compound = cy.getElementById(groupId);

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
      cy.getElementById(getGroupCloseId(groupId));
      compound.remove();

      onSaveGraph();
    }

    function onGroupDeleteContext() {
      if (!menuTargetRef.current || !cyRef.current) return;

      onGroupDelete(menuTargetRef.current);
    }

    function onGroupClose(e: EventObject) {
      const btnNode = e.target as NodeSingular;
      const closeId = btnNode.id();

      const groupId = closeId.replace(/^close-/, '');
      onGroupDelete(groupId);
    }

    function getGroupCloseId(groupId: string) {
      return `close-${groupId}`;
    }

    function closeGroupDeleteBtn() {
      cyRef.current?.nodes('.compound-close-btn').style('visibility', 'hidden');
    }

    function onEdgeClick(event: cytoscape.EventObject) {
      if (!event.target.hasClass(GHOST_EDGE_ID)) return;

      exitConnectionMode();
      closeRadialMenu();
      cyRef.current?.elements().unselect();
      closeGroupDeleteBtn();
    }

    function onNodeClick(event: cytoscape.EventObject) {
      if (!cyRef.current) return;

      const cy = cyRef.current;
      const node = event.target;
      const nodeId = node.id();

      if (node.hasClass(GHOST_NODE_ID)) {
        exitConnectionMode();
        closeRadialMenu();
        cyRef.current?.elements().unselect();
        closeGroupDeleteBtn();
        return;
      }

      closeGroupDeleteBtn();
      if (node.hasClass('compound-close-btn')) return;

      if (node.hasClass('drawn-shape')) {
        const closeBtnId = getGroupCloseId(nodeId);
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

      if (nodeConnectTarget.current && nodeConnectTarget !== nodeId) {
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
    }

    function onGraphClick(event: EventObject) {
      if (event.target === cyRef.current) {
        closeRadialMenu();
        cyRef.current?.elements().unselect();
        closeGroupDeleteBtn();
      }
    }

    function closeRadialMenu() {
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

    function onDoubleClick(event: cytoscape.EventObject) {
      if (event.target.hasClass('drawn-shape')) return;

      const nodeId = event.target.id();
      if (!nodeId || !contextMenuRef.current) return;

      closeRadialMenu();
      props.onEditNode(nodeId);
    }

    function onEdgeContext(event: cytoscape.EventObject) {
      if (event.target.hasClass(GHOST_EDGE_ID)) {
        exitConnectionMode();
      }

      if (!contextMenuRef.current) return;

      const mouseEvent = event.originalEvent as unknown as MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();

      setContextMenuModel(edgeContextMenuModel);
      menuTargetRef.current = event.target.id();
      contextMenuRef.current.show(mouseEvent);
    }

    function onGraphContext(event: cytoscape.EventObject) {
      exitDrawMode();

      if (!contextMenuRef.current) return;

      const mouseEvent = event.originalEvent as unknown as MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();

      setContextMenuModel(graphContextMenuModel);
      contextMenuRef.current.show(mouseEvent);
    }

    function onNodeContext(event: cytoscape.EventObject) {
      exitConnectionMode();

      if (!contextMenuRef.current) return;

      const mouseEvent = event.originalEvent as unknown as MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();

      if (event.target.hasClass('drawn-shape')) {
        setContextMenuModel(groupContextMenuModel);
      } else {
        setContextMenuModel(nodeContextMenuModel);
      }

      menuTargetRef.current = event.target.id();
      contextMenuRef.current.show(mouseEvent);
    }

    function onDrag() {
      closeRadialMenu();
      exitConnectionMode();
      closeGroupDeleteBtn();
      exitDrawMode();
    }

    function onDragStart(event: cytoscape.EventObject) {
      const node = event.target;
      if (!node || !node.isNode()) return;
    }

    function onDragEnd(event: cytoscape.EventObject) {
      const node = event.target;
      if (node?.isNode()) onSaveGraph();
    }

    const lastOpenedTopology = useRef<string | null>(null);

    function onFitGraph() {
      if (!cyRef.current) return;

      cyRef.current.animate(
        {
          fit: {
            eles: cyRef.current.elements(),
            padding: 100,
          },
        },
        {
          duration: 200,
          easing: 'ease-in-out',
        }
      );
    }

    function onClearGraph() {
      topologyStore.manager.clear();
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
        cyRef.current.remove(`.${GHOST_NODE_ID}`);
        cyRef.current.remove(`.${GHOST_EDGE_ID}`);
      }
    }

    function handleMouseDown(e: EventObject) {
      if (!isDrawModeOn.current || e.target !== cyRef.current) return;
      drawStartPos.current = e.position;
      drawEndPos.current = e.position;
    }

    function handleMouseMove(e: EventObject) {
      if (!isDrawModeOn.current || !drawStartPos) return;
      drawEndPos.current = e.position;
    }

    function handleMouseUp() {
      if (isDrawModeOn.current) {
        onDrawEnd();
      }
    }

    function initCytoscape(cy: cytoscape.Core) {
      cy.minZoom(0.3);
      cy.maxZoom(10);
      cy.style().fromJson(topologyStyle).update();

      cy.on('click', onGraphClick);
      cy.on('click', 'node.compound-close-btn', onGroupClose);
      cy.on('click', 'node', onNodeClick);
      cy.on('dbltap', 'node', onDoubleClick);
      cy.on('cxttap', onGraphContext);
      cy.on('cxttap', 'node', onNodeContext);
      cy.on('cxttap', 'edge', onEdgeContext);
      cy.on('grab', 'node', onDragStart);
      cy.on('free', 'node', onDragEnd);
      cy.on('drag', 'node', onDrag);
      cy.on('click', 'edge', onEdgeClick);
      cy.on('render', drawGridOverlay);
      cy.on('mousedown', handleMouseDown);
      cy.on('mousemove', handleMouseMove);
      cy.on('mouseup', handleMouseUp);

      onFitGraph();
    }

    function onGroupNameSubmit(
      groupName: string | undefined,
      isImplicit: boolean = false
    ) {
      if (!cyRef.current || !groupNameDialogState.state) return;

      const cy = cyRef.current;

      const dialogState = groupNameDialogState.state;

      // Skip validation if group name didn't change
      if (
        dialogState.action === DialogAction.Edit &&
        groupName === dialogState.groupName
      ) {
        groupNameDialogState.close();
        return;
      }

      if (!groupName || groupName === '') {
        if (!isImplicit) {
          groupRenameInput.current?.setValidationError(
            "Group name can't be empty"
          );
        }
      } else if (cyRef.current.hasElementWithId(groupName)) {
        groupRenameInput.current?.setValidationError(
          'A group with this name already exists'
        );
      } else if (dialogState.action === DialogAction.Add) {
        createDrawnGroup(groupName);
        groupNameDialogState.close();
      } else {
        const oldGroupName = dialogState.groupName;
        cy.batch(() => {
          cy.add({
            group: 'nodes',
            data: {
              id: groupName,
              label: groupName,
            },
            classes: 'drawn-shape',
          });

          cy.nodes().forEach(node => {
            const parents = node.parent();
            if (parents.length > 0 && parents[0].id() === oldGroupName) {
              node.move({parent: groupName});
            }
          });

          cy.getElementById(oldGroupName!).remove();
        });

        groupNameDialogState.close();
        onSaveGraph();
      }
    }

    function createDrawnGroup(groupName: string) {
      if (!cyRef.current || !drawStartPos.current || !drawEndPos.current) {
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
          if (n.hasClass('compound-close-btn') || !n.parent()) return false;
          const {x: nx, y: ny} = n.position();
          return nx >= x && nx <= x + w && ny >= y && ny <= y + h;
        })
        .toArray();

      if (hitsArray.length > 0) {
        cy.batch(() => {
          // Add group node to graph
          cy.add({
            group: 'nodes',
            data: {
              id: groupName,
              label: groupName,
            },
            classes: 'drawn-shape',
          });
          hitsArray.forEach(node =>
            cy.getElementById(node.id()).move({parent: groupName})
          );
        });
      }

      // Add group close button to graph
      cy.add({
        group: 'nodes',
        data: {id: getGroupCloseId(groupName), parent: groupName},
        position: {x: 0, y: 0},
        classes: 'compound-close-btn',
      });

      drawStartPos.current = null;
      drawEndPos.current = null;
      onSaveGraph();
    }

    function onDrawEnd() {
      if (!cyRef.current || !drawStartPos.current || !drawEndPos.current) {
        return;
      }

      if (getDistance(drawStartPos.current, drawEndPos.current) < 20) {
        exitDrawMode();
        return;
      }

      const cy = cyRef.current;

      cy.nodes().unlock().grabify();
      cy.nodes('.drawn-shape').forEach(n => {
        n.style('events', 'yes');
      });

      exitDrawMode();

      groupNameDialogState.openWith({action: DialogAction.Add});
    }

    function onGroupEdit() {
      if (!menuTargetRef.current) return;

      groupNameDialogState.openWith({
        action: DialogAction.Edit,
        groupName: menuTargetRef.current,
      });
    }

    function enterDrawMode() {
      if (!cyRef.current) return;

      isDrawModeOn.current = true;
      cyRef.current.userPanningEnabled(false);

      (
        document.querySelector('.cytoscape-container') as HTMLElement
      ).style.cursor = 'crosshair';
    }

    function exitDrawMode() {
      if (!cyRef.current) return;

      isDrawModeOn.current = false;
      cyRef.current.userPanningEnabled(true);

      (
        document.querySelector('.cytoscape-container') as HTMLElement
      ).style.cursor = '';
    }

    function onDrawStart() {
      if (!cyRef.current) return;

      cyRef.current.nodes('.drawn-shape').forEach(n => {
        n.style('events', 'no');
      });

      enterDrawMode();
    }

    const groupContextMenuModel = [
      {label: 'Edit', icon: 'pi pi-pen-to-square', command: onGroupEdit},
      {label: 'Delete', icon: 'pi pi-trash', command: onGroupDeleteContext},
    ];

    const edgeContextMenuModel = [
      {label: 'Delete', icon: 'pi pi-trash', command: onEdgeDelete},
    ];

    const nodeContextMenuModel = [
      {
        label: 'Connect',
        icon: 'pi pi-arrow-right-arrow-left',
        command: onNodeConnect,
      },
      {label: 'Edit', icon: 'pi pi-pen-to-square', command: onNodeEdit},
      {label: 'Delete', icon: 'pi pi-trash', command: onNodeDelete},
    ];

    const graphContextMenuModel = [
      {
        label: 'Add Node',
        icon: 'pi pi-plus',
        command: props.onAddNode,
      },
      {
        label: 'Group Nodes',
        icon: <span className="material-symbols-outlined">Ink_Selection</span>,
        command: onDrawStart,
      },
      {
        label: 'Clear Graph',
        icon: 'pi pi-trash',
        command: onClearGraph,
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
        <div className="graph-container">
          <canvas ref={gridCanvasRef} className="grid-canvas" />
          <CytoscapeComponent
            className="cytoscape-container"
            elements={[]}
            layout={{name: 'preset'}}
            cy={(cy: cytoscape.Core) => {
              cyRef.current = cy;
              setIsCyReady(true);
            }}
            wheelSensitivity={0.3}
          />
        </div>
        <NodeToolbar
          onAddNode={props.onAddNode}
          onFitGraph={onFitGraph}
          onDrawGroup={onDrawStart}
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
          isOpen={groupNameDialogState.isOpen}
          onClose={groupNameDialogState.close}
          onSubmit={() => {
            onGroupNameSubmit(
              groupRenameInput.current?.input.current?.value,
              false
            );
          }}
          headerTitle="Set Group Label"
          submitLabel="Ok"
          onShow={() => groupRenameInput.current?.input.current?.focus()}
        >
          <SBInput
            ref={groupRenameInput}
            defaultValue={groupNameDialogState.state?.groupName}
            onValueSubmit={(value, isImplicit) =>
              onGroupNameSubmit(value, isImplicit)
            }
            placeholder="e.g. Backbone"
            id="node-editor-group-name"
            label="Group Name"
          />
        </SBDialog>
      </div>
    );
  }
);

export default NodeEditor;
