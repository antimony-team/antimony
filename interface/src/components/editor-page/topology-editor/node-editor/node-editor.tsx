import React, {MouseEvent, useEffect, useMemo, useRef, useState} from 'react';

import type {EventObject} from 'cytoscape';
import cytoscape, {NodeSingular} from 'cytoscape';
// @ts-expect-error This library does not have a type declaration
import coseBilkent from 'cytoscape-cose-bilkent';
import {observer} from 'mobx-react-lite';

import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';
import {SpeedDial} from 'primereact/speeddial';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import TopologyGraph, {
  TopologyGraphRef,
} from '@sb/components/common/topology-graph/topology-graph';
import {generateGraph} from '@sb/lib/graph/cytoscape-utils';
import {nodeLayoutLabels} from '@sb/lib/graph/topology-graph';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {getDistance} from '@sb/lib/utils/utils';
import {Topology} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

import SimulationPanel from './simulation-panel/simulation-panel';
import {useSimulationConfig} from './state/simulation-config';
import NodeToolbar from './toolbar/node-toolbar';

import './node-editor.sass';

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

const NodeEditor = observer((props: NodeEditorProps) => {
  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[] | null>(
    null,
  );

  const groupNameDialogState = useDialogState<GroupEditDialogState>();

  const deviceStore = useDeviceStore();
  const topologyStore = useTopologyStore();
  const simulationConfig = useSimulationConfig();

  const graphRef = useRef<TopologyGraphRef>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const radialMenuTarget = useRef<string | null>(null);
  const nodeConnectionSource = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<ContextMenu | null>(null);
  const radialMenuRef = useRef<SpeedDial>(null);
  const menuTargetRef = useRef<string | null>(null);
  const groupRenameInput = useRef<SBInputRef>(null);
  const drawStartPos = useRef<Position | null>(null);
  const drawEndPos = useRef<Position | null>(null);
  const isDrawModeOn = useRef<boolean>(false);
  const draggedNodeIds = useRef(new Set<string>());

  const elements = useMemo(() => {
    if (props.openTopology === null) return [];

    return generateGraph(props.openTopology, deviceStore);
  }, [deviceStore, props.openTopology?.definition]);

  useEffect(() => {
    closeRadialMenu();
  }, [elements]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onKeyDown]);

  function onStabilizeGraph() {
    const cy = cyRef.current;
    if (!cy) return;
    if (cy.elements().empty()) return;

    const layout = cy.layout({
      ...simulationConfig.config,
    });

    simulationConfig.setIsStabilizing(true);
    layout.run();
    void layout.promiseOn('layoutstop')?.then(() => {
      simulationConfig.setIsStabilizing(false);
    });

    onSaveGraph();
  }

  function drawConnectionLine(
    sourceId: string,
    mouseX: number,
    mouseY: number,
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

  function onNodeConnectStart() {
    const cy = cyRef.current;
    if (!cy || menuTargetRef.current === null) return;

    const nodeId = menuTargetRef.current;

    const node = cy.getElementById(nodeId);
    if (!node) return;

    nodeConnectionSource.current = nodeId;
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
    if (!cyRef.current || !nodeConnectionSource.current) return;

    const cy = cyRef.current as cytoscape.Core & {
      renderer: () => {
        projectIntoViewport: (x: number, y: number) => [number, number];
      };
    };

    const [x, y] = cy
      .renderer()
      .projectIntoViewport(event.clientX, event.clientY);

    drawConnectionLine(nodeConnectionSource.current, x, y);
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

    const memberIds = compound.children().map(child => child.id());

    compound.children().forEach(child => {
      (child as NodeSingular).move({parent: parentId});
    });
    compound.remove();

    onSaveGraph(memberIds);
  }

  function onGroupDeleteContext() {
    if (!menuTargetRef.current || !cyRef.current) return;

    onGroupDelete(menuTargetRef.current);
  }

  function onEdgeClick(event: cytoscape.EventObject) {
    if (!event.target.hasClass(GHOST_EDGE_ID)) return;

    exitConnectionMode();
    closeRadialMenu();
    cyRef.current?.elements().unselect();
  }

  function onNodeClick(event: cytoscape.EventObject) {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    const node = event.target;
    const nodeId = node.id();

    if (node.hasClass(GHOST_NODE_ID)) {
      exitConnectionMode();
      closeRadialMenu();
      cy.elements().unselect();
      return;
    }

    if (node.hasClass('drawn-shape')) {
      return;
    }

    if (nodeConnectionSource.current && nodeConnectionSource !== nodeId) {
      topologyStore.manager.connectNodes(nodeConnectionSource.current, nodeId);
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
      if (!element) return;

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

    if (element) element.dataset.popperAttachedTo = targetNodeId;

    radialMenuRef.current.show();
  }

  function onDoubleClick(event: cytoscape.EventObject) {
    if (event.target.hasClass('drawn-shape')) {
      menuTargetRef.current = event.target.id();
      onGroupEdit();

      return;
    }

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
    exitDrawMode();
  }

  /**
   * Nodes that are dragged together are freed one after another, so they are
   * collected and saved together once all of them are freed.
   */
  function onDragEnd(event: cytoscape.EventObject) {
    const node = event.target as NodeSingular;
    const movedNodes = node.isParent() ? node.descendants() : node;

    if (draggedNodeIds.current.size === 0) {
      queueMicrotask(() => {
        const nodeIds = [...draggedNodeIds.current];
        draggedNodeIds.current.clear();
        onSaveGraph(nodeIds);
      });
    }

    movedNodes.forEach(movedNode => {
      draggedNodeIds.current.add(movedNode.id());
    });
  }

  function onFitGraph() {
    graphRef.current?.fit(true);
  }

  function onClearGraph() {
    topologyStore.manager.clear();
  }

  /**
   * Writes the layout of the given nodes into the topology, or the layout of
   * all nodes if none are given.
   */
  function onSaveGraph(nodeIds?: string[]) {
    const cy = cyRef.current;
    const topology = topologyStore.manager.topology;

    if (!cy || !topology?.definition) return;

    const nodes = topology.definition.toJS().topology.nodes;
    const updatedLabelMap = new Map<string, Record<string, string | null>>();

    const savedNodeIds = nodeIds ? new Set(nodeIds) : null;

    for (const node of cy.nodes('.topology-node')) {
      if (savedNodeIds && !savedNodeIds.has(node.id())) continue;

      updatedLabelMap.set(
        node.id(),
        nodeLayoutLabels(
          nodes[node.id()]?.labels,
          node.position(),
          node.parent().data('label') ?? null,
        ),
      );
    }

    if (updatedLabelMap.size === 0) return;

    topologyStore.manager.updateNodeLabels(updatedLabelMap);
  }

  function exitConnectionMode() {
    nodeConnectionSource.current = null;

    if (cyRef.current) {
      cyRef.current.remove(`.${GHOST_NODE_ID}`);
      cyRef.current.remove(`.${GHOST_EDGE_ID}`);
    }
  }

  function onCyMouseDown(e: EventObject) {
    if (!isDrawModeOn.current || e.target !== cyRef.current) return;
    drawStartPos.current = e.position;
    drawEndPos.current = e.position;
  }

  function onCyMouseMove(e: EventObject) {
    if (!isDrawModeOn.current || !drawStartPos) return;
    drawEndPos.current = e.position;
  }

  function onMouseUp() {
    if (isDrawModeOn.current) {
      onDrawEnd();
    }
  }

  function onGroupNameSubmit(
    groupName: string | undefined,
    isImplicit: boolean = false,
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
          "Group name can't be empty",
        );
      }
    } else if (cyRef.current.hasElementWithId(groupName)) {
      groupRenameInput.current?.setValidationError(
        'A group with this name already exists',
      );
    } else if (dialogState.action === DialogAction.Add) {
      createDrawnGroup(groupName);
      groupNameDialogState.close();
    } else {
      const oldGroupName = dialogState.groupName;
      const memberIds: string[] = [];

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
            memberIds.push(node.id());
            node.move({parent: groupName});
          }
        });

        cy.getElementById(oldGroupName!).remove();
      });

      groupNameDialogState.close();
      onSaveGraph(memberIds);
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
        if (!n.parent()) return false;
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
          cy.getElementById(node.id()).move({parent: groupName}),
        );
      });
    }

    drawStartPos.current = null;
    drawEndPos.current = null;
    onSaveGraph(hitsArray.map(node => node.id()));
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
    cyRef.current.container()!.style.cursor = 'crosshair';
  }

  function exitDrawMode() {
    if (!cyRef.current) return;

    isDrawModeOn.current = false;
    cyRef.current.userPanningEnabled(true);
    cyRef.current.container()!.style.cursor = '';
  }

  function onDrawStart() {
    if (!cyRef.current) return;

    cyRef.current.nodes('.drawn-shape').forEach(n => {
      n.style('events', 'no');
    });

    enterDrawMode();
  }

  const groupContextMenuModel = [
    {
      label: 'Edit',
      icon: <span className="material-symbols-outlined">edit_square</span>,
      command: onGroupEdit,
    },
    {
      separator: true,
    },
    {
      label: 'Delete',
      icon: 'pi pi-trash',
      className: 'sb-menuitem-danger',
      command: onGroupDeleteContext,
    },
  ];

  const edgeContextMenuModel = [
    {
      label: 'Delete',
      icon: 'pi pi-trash',
      className: 'sb-menuitem-danger',
      command: onEdgeDelete,
    },
  ];

  const nodeContextMenuModel = [
    {
      label: 'Edit',
      icon: <span className="material-symbols-outlined">edit_square</span>,
      command: onNodeEdit,
    },
    {
      label: 'Connect',
      icon: 'pi pi-arrow-right-arrow-left',
      command: onNodeConnectStart,
    },
    {separator: true},
    {
      label: 'Delete',
      icon: 'pi pi-trash',
      className: 'sb-menuitem-danger',
      command: onNodeDelete,
    },
  ];

  const graphContextMenuModel = [
    {
      label: 'Add node',
      icon: 'pi pi-plus',
      command: props.onAddNode,
    },
    {
      label: 'Create group',
      icon: <span className="material-symbols-outlined">select</span>,
      command: onDrawStart,
    },
    {
      label: 'Fit graph',
      icon: <span className="material-symbols-outlined">fit_screen</span>,
      command: onFitGraph,
    },
    {
      separator: true,
    },
    {
      label: 'Clear graph',
      icon: 'pi pi-trash',
      className: 'sb-menuitem-danger',
      command: onClearGraph,
    },
  ];

  const nodeRadialMenuModel = [
    {
      label: 'Connect',
      icon: 'pi pi-arrow-right-arrow-left',
      command: onNodeConnectStart,
    },
    {
      label: 'Edit',
      icon: <span className="material-symbols-outlined">edit_square</span>,
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
      <TopologyGraph
        ref={graphRef}
        elements={elements}
        fitKey={props.openTopology?.id ?? null}
        events={{
          click: onGraphClick,
          'click node': onNodeClick,
          'click edge': onEdgeClick,
          'dbltap node': onDoubleClick,
          cxttap: onGraphContext,
          'cxttap node': onNodeContext,
          'cxttap edge': onEdgeContext,
          'dragfree node': onDragEnd,
          'drag node': onDrag,
          mousedown: onCyMouseDown,
          mousemove: onCyMouseMove,
          mouseup: onMouseUp,
        }}
        onInstance={cy => {
          cyRef.current = cy;
        }}
      />
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
      <ContextMenu model={contextMenuModel ?? undefined} ref={contextMenuRef} />
      <SBDialog
        isOpen={groupNameDialogState.isOpen}
        onClose={groupNameDialogState.close}
        onSubmit={() => {
          onGroupNameSubmit(
            groupRenameInput.current?.input.current?.value,
            false,
          );
        }}
        headerTitle="Edit group"
        submitLabel="Ok"
        onShow={() => groupRenameInput.current?.input.current?.focus()}
        width="400px"
      >
        <SBInput
          ref={groupRenameInput}
          defaultValue={groupNameDialogState.state?.groupName}
          onValueSubmit={(value, isImplicit) =>
            onGroupNameSubmit(value, isImplicit)
          }
          placeholder="e.g. Backbone"
          id="node-editor-group-name"
          label="Name"
        />
      </SBDialog>
    </div>
  );
});

export default NodeEditor;
