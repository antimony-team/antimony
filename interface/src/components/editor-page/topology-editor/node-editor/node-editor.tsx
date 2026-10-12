import React, {MouseEvent, useEffect, useMemo, useRef, useState} from 'react';

import type {EventObject} from 'cytoscape';
import cytoscape, {NodeSingular} from 'cytoscape';
// @ts-expect-error This library does not have a type declaration
import coseBilkent from 'cytoscape-cose-bilkent';
import {autorun} from 'mobx';
import {observer} from 'mobx-react-lite';

import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';

import AnnotationLayer from '@sb/components/common/topology-graph/annotation-layer/annotation-layer';
import TopologyGraph, {
  TopologyGraphRef,
} from '@sb/components/common/topology-graph/topology-graph';
import {
  graphMenu,
  groupMenu,
  linkMenu,
  nodeMenu,
  selectionMenu,
  shapeMenu,
} from '@sb/components/editor-page/topology-editor/node-editor/graph-context-menus';
import GroupRename from '@sb/components/editor-page/topology-editor/node-editor/group-rename/group-rename';
import SelectionOverlay, {
  LineEnd,
} from '@sb/components/editor-page/topology-editor/node-editor/selection-overlay/selection-overlay';
import {
  GraphTool,
  TOOL_SHAPES,
  useGraphSelection,
} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  Box,
  boxBetween,
  containsBox,
  containsPoint,
  defaultShapeGeometry,
  drawnShapeGeometry,
  fitIntoGroupBox,
  GraphGroup,
  GraphShape,
  groupAt,
  groupBoxAround,
  GroupHitPart,
  growGroupBox,
  hitTestLayers,
  LayerHit,
  moveBox,
  moveShapeGeometry,
  roundCoordinate,
  roundPosition,
  shapeBox,
  ShapeGeometry,
  shapeGeometry,
  shiftIntoBox,
} from '@sb/lib/graph/annotation-geometry';
import {
  AnnotationStyle,
  defaultStyle,
  groupStyleReset,
  groupStyleUpdate,
  newShapeStyle,
  shapeStyleUpdate,
} from '@sb/lib/graph/annotation-style';
import {
  generateGraph,
  generateGroups,
  generateLayerItems,
  toGraphPosition,
  toRenderedBox,
} from '@sb/lib/graph/cytoscape-utils';
import {GraphAction, matchGraphKeybind} from '@sb/lib/graph/graph-keybinds';
import {GRID_SPACING, OccupiedPositions} from '@sb/lib/graph/placement';
import {NodeLayout} from '@sb/lib/graph/topology-graph';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';
import {useStableCallbacks} from '@sb/lib/utils/hooks';
import {
  FreeShapeAnnotation,
  GroupStyleAnnotation,
  Topology,
} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

import SimulationPanel from './simulation-panel/simulation-panel';
import {useSimulationConfig} from './state/simulation-config';
import NodeToolbar from './toolbar/node-toolbar';
import ZoomControl from './zoom-control/zoom-control';

import './node-editor.sass';

cytoscape.use(coseBilkent);

interface NodeEditorProps {
  openTopology: Topology | null;

  onEditNode: (nodeName: string) => void;

  // Called with the position in the graph where the new node is placed
  onAddNode: (position: Position) => void;
}

const GHOST_EDGE_ID = 'ghost-edge';
const GHOST_NODE_ID = 'ghost-node';

const NUDGE_DISTANCE = 5;
const NUDGE_MERGE_KEY = 'nudge';

// Factor by which the zoom buttons change the zoom
const ZOOM_STEP = 1.25;

// Moving the pointer by less than this many pixels counts as a click, like in cytoscape
const DRAG_THRESHOLD = 5;

// Distance in pixels at which lines and outlines of shapes are still hit
const HIT_TOLERANCE = 6;

// Shapes that are drawn smaller than this are placed with their default size
const MIN_SHAPE_SIZE = 4;

type PointerAction =
  | {
      kind: 'select-box';
      origin: Position;
      originClient: Position;
      isAdditive: boolean;
      hasMoved: boolean;
    }
  | {
      kind: 'move-layers';
      origin: Position;
      originClient: Position;
      pointer: Position;
      boxes: Map<string, Box>;
      shapes: Map<string, ShapeGeometry>;
      memberPositions: Map<string, Position>;
      hasMoved: boolean;
    }
  | {
      kind: 'draw';
      shapeType: FreeShapeAnnotation['shapeType'];
      origin: Position;
      originClient: Position;
      hasMoved: boolean;
    }
  | {
      kind: 'move-line-end';
      shapeId: string;
      end: LineEnd;
      geometry: ShapeGeometry;
      hasMoved: boolean;
    }
  | {kind: 'pan'; lastClient: Position};

type MoveLayersAction = Extract<PointerAction, {kind: 'move-layers'}>;

/**
 * Where the dragged nodes end up when they are dropped. A node joins the group
 * it is dropped on, and a member stays in its group, which grows to contain it,
 * unless ctrl is held.
 */
interface DropPlan {
  groupIds: Map<string, string | null>;
  groupBoxes: Map<string, Box>;
  hint: string | null;
  dropTargetId: string | null;
}

const NodeEditor = observer((props: NodeEditorProps) => {
  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[] | null>(
    null,
  );

  const deviceStore = useDeviceStore();
  const topologyStore = useTopologyStore();
  const simulationConfig = useSimulationConfig();
  const graphSelection = useGraphSelection();

  const graphRef = useRef<TopologyGraphRef>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const nodeConnectionSource = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<ContextMenu | null>(null);
  const menuTargetRef = useRef<string | null>(null);
  // Position in the graph where the context menu of the graph was opened
  const contextMenuPosition = useRef<Position>({x: 0, y: 0});
  const draggedNodeIds = useRef(new Set<string>());
  const pointerAction = useRef<PointerAction | null>(null);
  const isDragCtrl = useRef(false);
  const dragFrame = useRef(0);
  const moveFrame = useRef(0);

  // Positions of the members of a resized group from before it was resized
  const resizeMemberStarts = useRef<Map<string, Position> | null>(null);

  /*
   * The targets of the last two taps. Cytoscape emits a double tap for any two
   * taps in quick succession, so it only counts if both taps hit the same target.
   */
  const tapTargets = useRef<[string | null, string | null]>([null, null]);
  // Whether the graph was the last part of the page that was clicked
  const isGraphActive = useRef(false);

  const elements = useMemo(() => {
    if (props.openTopology === null) return [];

    return generateGraph(props.openTopology, deviceStore);
  }, [
    deviceStore,
    props.openTopology?.definition,
    props.openTopology?.annotations,
  ]);

  const groups = useMemo(() => {
    if (props.openTopology === null) return [];

    return generateGroups(props.openTopology, elements);
  }, [elements]);

  const layerItems = useMemo(() => {
    if (props.openTopology === null) return [];

    return generateLayerItems(props.openTopology, groups);
  }, [groups]);

  // The handlers below are registered once, they reach the current state through these refs
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const layerItemsRef = useRef(layerItems);
  layerItemsRef.current = layerItems;

  const handlersRef = useRef({onKeyDown, onKeyUp, onPointerMove, onPointerUp});
  handlersRef.current = {onKeyDown, onKeyUp, onPointerMove, onPointerUp};

  useEffect(() => {
    const onMouseDownCapture = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      isGraphActive.current =
        !!containerRef.current?.contains(target) ||
        !!target?.closest?.('.p-contextmenu, .sb-selection-popover');
    };
    const onKeyDown = (event: KeyboardEvent) =>
      handlersRef.current.onKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) =>
      handlersRef.current.onKeyUp(event);
    const onMouseMove = (event: globalThis.MouseEvent) =>
      handlersRef.current.onPointerMove(event);
    const onMouseUp = (event: globalThis.MouseEvent) =>
      handlersRef.current.onPointerUp(event);
    const onBlur = () => graphSelection.setHandHeld(false);

    window.addEventListener('mousedown', onMouseDownCapture, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('mousedown', onMouseDownCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(
    () =>
      autorun(() => {
        applyTool(graphSelection.isHandActive);

        // Set on the element directly, so switching tools doesn't render the editor again
        containerRef.current?.classList.toggle(
          'sb-node-editor-hand',
          graphSelection.isHandActive,
        );
        containerRef.current?.classList.toggle(
          'sb-node-editor-draw',
          graphSelection.isDrawToolActive,
        );
      }),
    [],
  );

  useEffect(() => {
    graphSelection.setLayers([], []);
    graphSelection.setRenamingGroup(null);
  }, [props.openTopology?.id]);

  // Groups and shapes that were removed, e.g. by undo, are removed from the selection
  useEffect(() => {
    const ids = new Set(layerItems.map(item => item.id));
    const groupIds = graphSelection.groupIds.filter(id => ids.has(id));
    const shapeIds = graphSelection.shapeIds.filter(id => ids.has(id));

    if (
      groupIds.length !== graphSelection.groupIds.length ||
      shapeIds.length !== graphSelection.shapeIds.length
    ) {
      graphSelection.setLayers(groupIds, shapeIds);
    }
  }, [layerItems]);

  /**
   * Panning stays enabled with all tools, as cytoscape only zooms with the
   * mouse wheel while it is. It is paused while a box is drawn or annotations
   * are moved.
   */
  function applyTool(isHandActive: boolean) {
    const cy = cyRef.current;
    if (!cy) return;

    cy.autoungrabify(isHandActive);
    cy.autounselectify(isHandActive);
  }

  function onInstance(cy: cytoscape.Core) {
    cyRef.current = cy;

    cy.boxSelectionEnabled(false);
    applyTool(graphSelection.isHandActive);

    let isSyncPending = false;
    const syncSelection = () => {
      if (isSyncPending) return;
      isSyncPending = true;

      queueMicrotask(() => {
        isSyncPending = false;
        graphSelection.setElements(
          cy.nodes('.topology-node:selected').map(node => node.id()),
          cy.edges(':selected').map(edge => edge.id()),
        );
      });
    };

    let frame = 0;
    const onViewport = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        graphSelection.setViewport(cy.zoom(), {...cy.pan()});
      });
    };
    graphSelection.setViewport(cy.zoom(), {...cy.pan()});

    cy.on('select unselect', syncSelection);
    cy.on('viewport', onViewport);

    return () => {
      cy.off('select unselect', syncSelection);
      cy.off('viewport', onViewport);
    };
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

    nodeConnectionSource.current = menuTargetRef.current;
  }

  function onNodeEdit() {
    if (!cyRef.current || menuTargetRef.current === null) return;

    props.onEditNode(menuTargetRef.current);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!isGraphActive.current || isTextInput(event.target)) return;

    if (event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) graphSelection.setHandHeld(true);
      return;
    }

    const action = matchGraphKeybind(event);
    if (action === null) return;

    event.preventDefault();
    runAction(action, event.shiftKey);
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === ' ') graphSelection.setHandHeld(false);
  }

  function runAction(action: GraphAction, isShift: boolean) {
    const nudgeDistance = isShift ? GRID_SPACING : NUDGE_DISTANCE;

    switch (action) {
      case GraphAction.SelectAll:
        onSelectAll();
        break;
      case GraphAction.Deselect:
        exitConnectionMode();
        deselectAll();
        if (graphSelection.isDrawToolActive) {
          graphSelection.setTool(GraphTool.Select);
        }
        break;
      case GraphAction.Delete:
        onDeleteSelection();
        break;
      case GraphAction.Group:
        onGroupSelection();
        break;
      case GraphAction.Ungroup:
        onUngroup();
        break;
      case GraphAction.BringToFront:
        onReorder(true);
        break;
      case GraphAction.SendToBack:
        onReorder(false);
        break;
      case GraphAction.NudgeLeft:
        onNudge({x: -nudgeDistance, y: 0});
        break;
      case GraphAction.NudgeRight:
        onNudge({x: nudgeDistance, y: 0});
        break;
      case GraphAction.NudgeUp:
        onNudge({x: 0, y: -nudgeDistance});
        break;
      case GraphAction.NudgeDown:
        onNudge({x: 0, y: nudgeDistance});
        break;
      case GraphAction.SelectTool:
        graphSelection.setTool(GraphTool.Select);
        break;
      case GraphAction.HandTool:
        graphSelection.setTool(GraphTool.Hand);
        break;
      case GraphAction.RectangleTool:
        graphSelection.setTool(GraphTool.Rectangle);
        break;
      case GraphAction.EllipseTool:
        graphSelection.setTool(GraphTool.Ellipse);
        break;
      case GraphAction.LineTool:
        graphSelection.setTool(GraphTool.Line);
        break;
    }
  }

  function onMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (!cyRef.current || !nodeConnectionSource.current) return;

    const {x, y} = toGraphPosition(cyRef.current, event.clientX, event.clientY);

    drawConnectionLine(nodeConnectionSource.current, x, y);
  }

  // The middle mouse button always pans the graph
  function onMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 1) return;

    event.preventDefault();
    graphSelection.setHandHeld(true);
    pointerAction.current = {
      kind: 'pan',
      lastClient: {x: event.clientX, y: event.clientY},
    };
  }

  /**
   * Shapes are drawn over everything, nodes included. The press doesn't reach
   * the graph, so it doesn't select or move anything in it.
   */
  function onMouseDownCapture(event: MouseEvent<HTMLDivElement>) {
    const cy = cyRef.current;
    const shapeType = graphSelection.isDrawToolActive
      ? TOOL_SHAPES.get(graphSelection.tool)
      : undefined;
    if (
      !cy ||
      !shapeType ||
      event.button !== 0 ||
      !cy.container()?.contains(event.target as Node)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    graphSelection.setPointerDown(true);

    pointerAction.current = {
      kind: 'draw',
      shapeType,
      origin: toGraphPosition(cy, event.clientX, event.clientY),
      originClient: {x: event.clientX, y: event.clientY},
      hasMoved: false,
    };
  }

  function onGraphPointerDown(event: EventObject) {
    const cy = cyRef.current;
    const mouseEvent = event.originalEvent as unknown as globalThis.MouseEvent;
    if (
      !cy ||
      event.target !== cy ||
      mouseEvent?.button !== 0 ||
      graphSelection.isHandActive ||
      nodeConnectionSource.current
    ) {
      return;
    }

    graphSelection.setPointerDown(true);

    const originClient = {x: mouseEvent.clientX, y: mouseEvent.clientY};

    const isCtrl = mouseEvent.ctrlKey || mouseEvent.metaKey;

    // Ctrl draws a box inside a group instead of moving the group
    const hit = isCtrl ? null : hitTestLayer(event.position);
    cy.userPanningEnabled(false);

    if (!hit) {
      if (!mouseEvent.shiftKey) graphSelection.setLayers([], []);

      pointerAction.current = {
        kind: 'select-box',
        origin: event.position,
        originClient,
        isAdditive: mouseEvent.shiftKey,
        hasMoved: false,
      };
      return;
    }

    const hitId = hit.kind === 'group' ? hit.group.id : hit.shape.id;

    if (mouseEvent.shiftKey) {
      if (hit.kind === 'group') graphSelection.toggleGroup(hitId);
      else graphSelection.toggleShape(hitId);
    } else if (!graphSelection.layerIds.includes(hitId)) {
      cy.elements().unselect();
      graphSelection.setLayers(
        hit.kind === 'group' ? [hitId] : [],
        hit.kind === 'shape' ? [hitId] : [],
      );
    }

    const movedGroups = groupsRef.current.filter(group =>
      graphSelection.groupIds.includes(group.id),
    );
    const memberPositions = new Map<string, Position>();

    for (const group of movedGroups) {
      for (const memberId of group.memberIds) {
        memberPositions.set(memberId, {
          ...cy.getElementById(memberId).position(),
        });
      }
    }

    const shapes = new Map(
      selectedShapes().map(shape => [
        shape.id,
        shapeGeometry(shape.annotation),
      ]),
    );

    pointerAction.current = {
      kind: 'move-layers',
      origin: event.position,
      originClient,
      pointer: event.position,
      boxes: new Map(movedGroups.map(group => [group.id, boxOf(group)])),
      shapes,
      memberPositions,
      hasMoved: false,
    };
  }

  function onLineEndPointerDown(
    shapeId: string,
    end: LineEnd,
    event: MouseEvent,
  ) {
    const item = findLayerItem(shapeId);
    if (item?.kind !== 'shape') return;

    event.preventDefault();
    graphSelection.setPointerDown(true);

    pointerAction.current = {
      kind: 'move-line-end',
      shapeId,
      end,
      geometry: shapeGeometry(item.shape.annotation),
      hasMoved: false,
    };
  }

  function findLayerItem(id: string) {
    return layerItemsRef.current.find(item => item.id === id) ?? null;
  }

  function selectedShapes(): GraphShape[] {
    return layerItemsRef.current
      .filter(item => item.kind === 'shape')
      .map(item => item.shape)
      .filter(shape => graphSelection.shapeIds.includes(shape.id));
  }

  function hitTestLayer(position: Position): LayerHit | null {
    return hitTestLayers(
      layerItemsRef.current,
      position,
      HIT_TOLERANCE / (cyRef.current?.zoom() ?? 1),
    );
  }

  function onPointerMove(event: globalThis.MouseEvent) {
    const cy = cyRef.current;
    const action = pointerAction.current;
    if (!cy || !action) return;

    if (action.kind === 'pan') {
      cy.panBy({
        x: event.clientX - action.lastClient.x,
        y: event.clientY - action.lastClient.y,
      });
      action.lastClient = {x: event.clientX, y: event.clientY};
      return;
    }

    const position = toGraphPosition(cy, event.clientX, event.clientY);

    if (action.kind === 'move-line-end') {
      action.hasMoved = true;
      graphSelection.setInteracting(true);
      graphSelection.setShapePreviews(
        new Map([
          [action.shapeId, movedLineEnd(action, position, event.shiftKey)],
        ]),
      );
      return;
    }

    const isBeyondThreshold =
      Math.hypot(
        event.clientX - action.originClient.x,
        event.clientY - action.originClient.y,
      ) >= DRAG_THRESHOLD;

    if (action.kind === 'draw') {
      if (!isBeyondThreshold && !action.hasMoved) return;

      action.hasMoved = true;
      const geometry = drawnShapeGeometry(
        action.shapeType,
        action.origin,
        position,
        event.shiftKey,
      );

      graphSelection.setDrawPreview({shapeType: action.shapeType, geometry});
      graphSelection.setDrag(
        drawHint(action.shapeType, geometry),
        null,
        new Map(),
      );
      return;
    }

    if (action.kind === 'select-box') {
      if (!isBeyondThreshold && !action.hasMoved) return;

      action.hasMoved = true;
      graphSelection.setInteracting(true);
      graphSelection.setSelectionBox(
        toRenderedBox(cy, boxBetween(action.origin, position)),
      );
      return;
    }

    if (!isBeyondThreshold && !action.hasMoved) return;

    action.hasMoved = true;
    action.pointer = position;
    graphSelection.setInteracting(true);

    /*
     * The members move right away, cytoscape draws them in its own animation
     * frame, which runs before the one requested here. The boxes are rendered
     * by React, so they only change once per frame.
     */
    moveMembers(action);

    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      if (pointerAction.current?.kind === 'move-layers') {
        moveLayerPreviews(pointerAction.current);
      }
    });
  }

  function moveDelta(action: MoveLayersAction) {
    return {
      x: action.pointer.x - action.origin.x,
      y: action.pointer.y - action.origin.y,
    };
  }

  function moveMembers(action: MoveLayersAction) {
    const cy = cyRef.current;
    if (!cy) return;

    const delta = moveDelta(action);

    cy.batch(() => {
      for (const [memberId, start] of action.memberPositions) {
        cy.getElementById(memberId).position({
          x: start.x + delta.x,
          y: start.y + delta.y,
        });
      }
    });
  }

  function moveLayerPreviews(action: MoveLayersAction) {
    const delta = moveDelta(action);

    graphSelection.setDrag(
      null,
      null,
      new Map([...action.boxes].map(([id, box]) => [id, moveBox(box, delta)])),
    );
    graphSelection.setShapePreviews(
      new Map(
        [...action.shapes].map(([id, geometry]) => [
          id,
          moveShapeGeometry(geometry, delta),
        ]),
      ),
    );
  }

  /**
   * Returns the geometry of the line with the dragged end at the given position.
   * Shift keeps the line horizontal or vertical.
   */
  function movedLineEnd(
    action: Extract<PointerAction, {kind: 'move-line-end'}>,
    position: Position,
    isShift: boolean,
  ): ShapeGeometry {
    const fixed =
      action.end === 'start'
        ? action.geometry.endPosition!
        : action.geometry.position;
    const moved = drawnShapeGeometry(
      'line',
      fixed,
      position,
      isShift,
    ).endPosition!;

    return action.end === 'start'
      ? {position: moved, endPosition: fixed}
      : {position: fixed, endPosition: moved};
  }

  function onPointerUp(event: globalThis.MouseEvent) {
    const cy = cyRef.current;
    const action = pointerAction.current;
    pointerAction.current = null;
    graphSelection.setPointerDown(false);
    if (!cy || !action) return;

    if (action.kind === 'pan') {
      graphSelection.setHandHeld(false);
      return;
    }

    cy.userPanningEnabled(true);
    graphSelection.setInteracting(false);

    if (action.kind === 'draw') {
      const position = toGraphPosition(cy, event.clientX, event.clientY);
      commitDraw(action, position, event.shiftKey);
      return;
    }

    if (action.kind === 'move-line-end') {
      const geometry = graphSelection.shapePreviews.get(action.shapeId);
      graphSelection.clearDrag();
      if (!action.hasMoved || !geometry) return;

      topologyStore.manager.updateLayout({
        shapes: new Map([[action.shapeId, geometry]]),
      });
      return;
    }

    if (action.kind === 'select-box') {
      if (!action.hasMoved) return;

      const position = toGraphPosition(cy, event.clientX, event.clientY);
      selectInBox(boxBetween(action.origin, position), action.isAdditive);
      graphSelection.setSelectionBox(null);
      return;
    }

    if (!action.hasMoved) return;

    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    action.pointer = toGraphPosition(cy, event.clientX, event.clientY);
    moveMembers(action);
    moveLayerPreviews(action);

    const groupUpdates = new Map<string, Partial<GroupStyleAnnotation>>();
    for (const [id, box] of graphSelection.groupPreviews) {
      groupUpdates.set(id, {position: roundPosition(box)});
    }

    const shapeUpdates = new Map(graphSelection.shapePreviews);

    const memberGroupIds = currentGroupIds();
    const nodeLayouts = new Map<string, NodeLayout>();
    for (const memberId of action.memberPositions.keys()) {
      nodeLayouts.set(memberId, {
        position: cy.getElementById(memberId).position(),
        groupId: memberGroupIds.get(memberId) ?? null,
      });
    }

    graphSelection.clearDrag();
    topologyStore.manager.updateLayout({
      nodes: nodeLayouts,
      groups: groupUpdates,
      shapes: shapeUpdates,
    });
  }

  function commitDraw(
    action: Extract<PointerAction, {kind: 'draw'}>,
    position: Position,
    isShift: boolean,
  ) {
    const cy = cyRef.current;
    graphSelection.setDrawPreview(null);
    graphSelection.clearDrag();
    graphSelection.setTool(GraphTool.Select);
    if (!cy) return;

    const drawn = drawnShapeGeometry(
      action.shapeType,
      action.origin,
      position,
      isShift,
    );
    const box = shapeBox(drawn);
    const isLargeEnough =
      action.shapeType === 'line'
        ? Math.max(box.width, box.height) >= MIN_SHAPE_SIZE
        : Math.min(box.width, box.height) >= MIN_SHAPE_SIZE;

    const geometry =
      action.hasMoved && isLargeEnough
        ? drawn
        : defaultShapeGeometry(action.shapeType, roundPosition(action.origin));

    const shapeId = topologyStore.manager.addShape({
      shapeType: action.shapeType,
      ...geometry,
      ...newShapeStyle(action.shapeType),
    });
    if (shapeId === null) return;

    cy.elements().unselect();
    graphSelection.setLayers([], [shapeId]);
  }

  function selectInBox(box: Box, isAdditive: boolean) {
    const cy = cyRef.current;
    if (!cy) return;

    if (!isAdditive) cy.elements().unselect();

    cy.nodes('.topology-node')
      .filter(node => containsPoint(box, node.position()))
      .select();

    const groupIds = groupsRef.current
      .filter(group => containsBox(box, boxOf(group)))
      .map(group => group.id);
    const shapeIds = layerItemsRef.current
      .filter(
        item =>
          item.kind === 'shape' &&
          containsBox(box, shapeBox(shapeGeometry(item.shape.annotation))),
      )
      .map(item => item.id);

    graphSelection.setLayers(
      isAdditive
        ? [...new Set([...graphSelection.groupIds, ...groupIds])]
        : groupIds,
      isAdditive
        ? [...new Set([...graphSelection.shapeIds, ...shapeIds])]
        : shapeIds,
    );
  }

  function onEdgeClick(event: cytoscape.EventObject) {
    if (!event.target.hasClass(GHOST_EDGE_ID)) return;

    exitConnectionMode();
    cyRef.current?.elements().unselect();
  }

  function onNodeClick(event: cytoscape.EventObject) {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    const node = event.target;
    const nodeId = node.id();

    if (node.hasClass(GHOST_NODE_ID)) {
      exitConnectionMode();
      cy.elements().unselect();
      return;
    }

    if (nodeConnectionSource.current && nodeConnectionSource !== nodeId) {
      topologyStore.manager.connectNodes(nodeConnectionSource.current, nodeId);
      exitConnectionMode();
      return;
    }

    if (!(event.originalEvent as unknown as globalThis.MouseEvent)?.shiftKey) {
      graphSelection.setLayers([], []);
    }
  }

  function onTap(event: EventObject) {
    const cy = cyRef.current;
    if (!cy) return;

    const hit = event.target === cy ? hitTestLayer(event.position) : null;
    const target =
      event.target === cy
        ? `layer:${hit?.kind === 'group' ? hit.group.id : (hit?.shape.id ?? '')}`
        : `element:${event.target.id()}`;

    tapTargets.current = [tapTargets.current[1], target];
  }

  function isDoubleTapOnSameTarget() {
    return tapTargets.current[0] === tapTargets.current[1];
  }

  /**
   * Nodes are selected when they are pressed, so a node that is dragged right
   * away is selected while it moves. Shift is left to cytoscape, which toggles
   * the node when it is released.
   */
  function onNodePointerDown(event: EventObject) {
    const cy = cyRef.current;
    const node = event.target as NodeSingular;
    const mouseEvent = event.originalEvent as unknown as globalThis.MouseEvent;
    if (
      !cy ||
      mouseEvent?.button !== 0 ||
      graphSelection.isHandActive ||
      !node.hasClass('topology-node')
    ) {
      return;
    }

    graphSelection.setPointerDown(true);
    if (mouseEvent.shiftKey || node.selected()) return;

    cy.elements().unselect();
    graphSelection.setLayers([], []);
    node.select();
  }

  function onGraphClick(event: EventObject) {
    if (event.target === cyRef.current) {
      cyRef.current?.elements().unselect();
    }
  }

  function onNodeDoubleClick(event: cytoscape.EventObject) {
    const nodeId = event.target.id();
    if (!nodeId || graphSelection.isHandActive || !isDoubleTapOnSameTarget()) {
      return;
    }

    props.onEditNode(nodeId);
  }

  function onGraphDoubleClick(event: cytoscape.EventObject) {
    const cy = cyRef.current;
    if (
      !cy ||
      event.target !== cy ||
      graphSelection.isHandActive ||
      !isDoubleTapOnSameTarget()
    ) {
      return;
    }

    const hit = hitTestLayer(event.position);
    if (hit?.kind === 'group' && hit.part === GroupHitPart.Label) {
      graphSelection.setRenamingGroup(hit.group.id);
    }
  }

  function onEdgeContext(event: cytoscape.EventObject) {
    if (event.target.hasClass(GHOST_EDGE_ID)) {
      exitConnectionMode();
    }

    const mouseEvent = event.originalEvent as unknown as MouseEvent;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    if (!contextMenuRef.current || graphSelection.isHandActive) return;

    selectForContextMenu(event.target);
    menuTargetRef.current = event.target.id();

    setContextMenuModel(
      selectionCount() > 1
        ? currentSelectionMenu()
        : linkMenu(onDeleteSelection),
    );
    showContextMenu(mouseEvent);
  }

  function onGraphContext(event: cytoscape.EventObject) {
    const cy = cyRef.current;
    if (!cy || event.target !== cy) return;

    const mouseEvent = event.originalEvent as unknown as MouseEvent;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    if (!contextMenuRef.current || graphSelection.isHandActive) return;

    contextMenuPosition.current = event.position;

    const hit = hitTestLayer(event.position);
    if (hit) {
      const hitId = hit.kind === 'group' ? hit.group.id : hit.shape.id;

      if (!graphSelection.layerIds.includes(hitId)) {
        cy.elements().unselect();
        graphSelection.setLayers(
          hit.kind === 'group' ? [hitId] : [],
          hit.kind === 'shape' ? [hitId] : [],
        );
      }

      menuTargetRef.current = hitId;
      setContextMenuModel(
        selectionCount() > 1
          ? currentSelectionMenu()
          : hit.kind === 'group'
            ? currentGroupMenu()
            : shapeMenu({
                shapeType: hit.shape.annotation.shapeType,
                onChangeShape: () => onChangeShape(hitId),
                onBringToFront: () => onReorder(true),
                onSendToBack: () => onReorder(false),
                onDelete: onDeleteSelection,
              }),
      );
    } else {
      setContextMenuModel(
        graphMenu({
          onAddNode: () => addNodeAt(contextMenuPosition.current),
          onSelectAll,
          onFit: onFitGraph,
          onClear: onClearGraph,
        }),
      );
    }

    showContextMenu(mouseEvent);
  }

  function onNodeContext(event: cytoscape.EventObject) {
    exitConnectionMode();

    const mouseEvent = event.originalEvent as unknown as MouseEvent;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    if (!contextMenuRef.current || graphSelection.isHandActive) return;

    selectForContextMenu(event.target);
    menuTargetRef.current = event.target.id();

    setContextMenuModel(
      selectionCount() > 1
        ? currentSelectionMenu()
        : nodeMenu({
            groups: groupsRef.current.map(group => ({
              id: group.id,
              name: group.name,
            })),
            onEdit: onNodeEdit,
            onConnect: onNodeConnectStart,
            onAddToGroup: onAddToGroup,
            onDelete: onDeleteSelection,
          }),
    );
    showContextMenu(mouseEvent);
  }

  // The bar and the resize handles are hidden while the menu is open
  function showContextMenu(event: MouseEvent) {
    graphSelection.setContextMenuOpen(true);
    contextMenuRef.current?.show(event);
  }

  /**
   * A right-click on an element that isn't selected selects only this element,
   * a right-click on a selected element keeps the selection.
   */
  function selectForContextMenu(element: cytoscape.SingularElementReturnValue) {
    if (element.selected()) return;

    cyRef.current?.elements().unselect();
    graphSelection.setLayers([], []);
    element.select();
  }

  function selectionCount() {
    const cy = cyRef.current;
    if (!cy) return 0;

    return (
      cy.nodes('.topology-node:selected').length +
      cy.edges(':selected').length +
      graphSelection.layerIds.length
    );
  }

  function currentSelectionMenu() {
    return selectionMenu({
      count: selectionCount(),
      canGroup: !!cyRef.current?.nodes('.topology-node:selected').nonempty(),
      canReorder: graphSelection.layerIds.length > 0,
      onGroup: onGroupSelection,
      onBringToFront: () => onReorder(true),
      onSendToBack: () => onReorder(false),
      onDelete: onDeleteSelection,
    });
  }

  function currentGroupMenu() {
    return groupMenu({
      onRename: () => graphSelection.setRenamingGroup(menuTargetRef.current),
      onSelectMembers: onSelectMembers,
      onBringToFront: () => onReorder(true),
      onSendToBack: () => onReorder(false),
      onUngroup: onUngroup,
      onDelete: onDeleteSelection,
    });
  }

  // Dragging moves all grabbed nodes, so the drop is only planned once per frame
  function onNodeDrag(event: cytoscape.EventObject) {
    const cy = cyRef.current;
    if (!cy) return;

    exitConnectionMode();

    const mouseEvent = event.originalEvent as unknown as
      | globalThis.MouseEvent
      | undefined;
    if (mouseEvent) {
      isDragCtrl.current = mouseEvent.ctrlKey || mouseEvent.metaKey;
    }

    const targetNodeId = event.target.id();
    if (dragFrame.current) return;

    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = 0;
      if (draggedNodeIds.current.size > 0) return;

      const plan = planDrop(
        cy.nodes('.topology-node:grabbed').map(node => node.id()),
        targetNodeId,
        isDragCtrl.current,
      );

      graphSelection.setInteracting(true);
      graphSelection.setDrag(plan.hint, plan.dropTargetId, plan.groupBoxes);
    });
  }

  /**
   * Nodes that are dragged together are freed one after another, so they are
   * collected and saved together once all of them are freed.
   */
  function onDragEnd(event: cytoscape.EventObject) {
    const node = event.target as NodeSingular;

    if (draggedNodeIds.current.size === 0) {
      queueMicrotask(() => {
        const nodeIds = [...draggedNodeIds.current];
        draggedNodeIds.current.clear();
        commitDrop(nodeIds);
      });
    }

    draggedNodeIds.current.add(node.id());
  }

  function commitDrop(nodeIds: string[]) {
    const cy = cyRef.current;
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    graphSelection.setInteracting(false);
    graphSelection.clearDrag();
    if (!cy || nodeIds.length === 0) return;

    const plan = planDrop(nodeIds, nodeIds[0], isDragCtrl.current);
    isDragCtrl.current = false;

    const nodeLayouts = new Map<string, NodeLayout>();
    for (const nodeId of nodeIds) {
      nodeLayouts.set(nodeId, {
        position: cy.getElementById(nodeId).position(),
        groupId: plan.groupIds.get(nodeId) ?? null,
      });
    }

    topologyStore.manager.updateLayout({
      nodes: nodeLayouts,
      groups: boxUpdates(plan.groupBoxes),
    });
  }

  function planDrop(
    nodeIds: string[],
    targetNodeId: string,
    isCtrl: boolean,
  ): DropPlan {
    const cy = cyRef.current!;
    const currentGroups = currentGroupIds();
    const groupIds = new Map<string, string | null>();
    const includedPositions = new Map<string, Position[]>();

    for (const nodeId of nodeIds) {
      const position = cy.getElementById(nodeId).position();
      const currentGroupId = currentGroups.get(nodeId) ?? null;
      const groupUnder = groupAt(groupsRef.current, position)?.id ?? null;

      let groupId = currentGroupId;
      if (groupUnder !== null && groupUnder !== currentGroupId) {
        groupId = groupUnder;
      } else if (currentGroupId !== null && isCtrl) {
        groupId = null;
      }

      groupIds.set(nodeId, groupId);
      if (groupId !== null) {
        includedPositions.set(groupId, [
          ...(includedPositions.get(groupId) ?? []),
          position,
        ]);
      }
    }

    const groupBoxes = new Map<string, Box>();
    for (const [groupId, positions] of includedPositions) {
      const group = groupsRef.current.find(group => group.id === groupId);
      if (!group) continue;

      const grownBox = growGroupBox(group, positions);
      if (grownBox !== group) groupBoxes.set(groupId, grownBox);
    }

    const label = nodeIds.length > 1 ? `${nodeIds.length} nodes` : targetNodeId;
    const currentGroupId = currentGroups.get(targetNodeId) ?? null;
    const nextGroupId = groupIds.get(targetNodeId) ?? null;
    const groupName = (groupId: string | null) =>
      groupsRef.current.find(group => group.id === groupId)?.name;

    let hint: string | null = null;
    let dropTargetId: string | null = null;

    if (nextGroupId !== null && nextGroupId !== currentGroupId) {
      hint = `Drop to add ${label} to ${groupName(nextGroupId)}`;
      dropTargetId = nextGroupId;
    } else if (currentGroupId !== null && nextGroupId === null) {
      hint = `${label} leaves ${groupName(currentGroupId)}`;
    } else if (currentGroupId !== null) {
      hint = `Hold Ctrl to move ${label} out of ${groupName(currentGroupId)}`;
    }

    return {groupIds, groupBoxes, hint, dropTargetId};
  }

  function onNudge(delta: Position) {
    const cy = cyRef.current;
    if (!cy || graphSelection.count === 0) return;

    const currentGroups = currentGroupIds();
    const movedGroups = groupsRef.current.filter(group =>
      graphSelection.groupIds.includes(group.id),
    );
    const movedNodeIds = new Set([
      ...graphSelection.nodeIds,
      ...movedGroups.flatMap(group => group.memberIds),
    ]);

    const nodeLayouts = new Map<string, NodeLayout>();
    for (const nodeId of movedNodeIds) {
      const position = cy.getElementById(nodeId).position();

      nodeLayouts.set(nodeId, {
        position: {x: position.x + delta.x, y: position.y + delta.y},
        groupId: currentGroups.get(nodeId) ?? null,
      });
    }

    const groupBoxes = new Map<string, Box>(
      movedGroups.map(group => [group.id, moveBox(group, delta)]),
    );

    // Groups of nudged members that don't move themselves grow to contain them
    for (const group of groupsRef.current) {
      if (groupBoxes.has(group.id)) continue;

      const positions = group.memberIds
        .filter(nodeId => nodeLayouts.has(nodeId))
        .map(nodeId => nodeLayouts.get(nodeId)!.position);
      const grownBox = growGroupBox(group, positions);

      if (grownBox !== group) groupBoxes.set(group.id, grownBox);
    }

    const shapeUpdates = new Map(
      selectedShapes().map(shape => [
        shape.id,
        moveShapeGeometry(shapeGeometry(shape.annotation), delta),
      ]),
    );

    topologyStore.manager.updateLayout(
      {
        nodes: nodeLayouts,
        groups: boxUpdates(groupBoxes),
        shapes: shapeUpdates,
      },
      NUDGE_MERGE_KEY,
    );
  }

  function onSelectAll() {
    cyRef.current?.nodes('.topology-node').select();
    graphSelection.setLayers(
      groupsRef.current.map(group => group.id),
      layerItemsRef.current
        .filter(item => item.kind === 'shape')
        .map(item => item.id),
    );
  }

  function deselectAll() {
    cyRef.current?.elements().unselect();
    graphSelection.setLayers([], []);
    graphSelection.setRenamingGroup(null);
  }

  function onReorder(toFront: boolean) {
    topologyStore.manager.reorderLayers(graphSelection.layerIds, toFront);
  }

  function onSelectMembers() {
    const cy = cyRef.current;
    const group = groupsRef.current.find(
      group => group.id === menuTargetRef.current,
    );
    if (!cy || !group) return;

    cy.elements().unselect();
    graphSelection.setLayers([], []);
    group.memberIds.forEach(nodeId => cy.getElementById(nodeId).select());
  }

  function onDeleteSelection() {
    const cy = cyRef.current;
    if (!cy || graphSelection.count === 0) return;

    const deletedGroups = groupsRef.current.filter(group =>
      graphSelection.groupIds.includes(group.id),
    );
    const nodeNames = [
      ...new Set([
        ...cy.nodes('.topology-node:selected').map(node => node.id()),
        ...deletedGroups.flatMap(group => group.memberIds),
      ]),
    ];
    const links = cy
      .edges(':selected')
      .filter(edge => !edge.hasClass(GHOST_EDGE_ID))
      .map(
        edge => [edge.data('source'), edge.data('target')] as [string, string],
      );

    const shapeIds = graphSelection.shapeIds;

    graphSelection.setLayers([], []);
    topologyStore.manager.deleteElements(
      nodeNames,
      links,
      deletedGroups.map(group => group.id),
      shapeIds,
    );
  }

  function onGroupSelection() {
    const cy = cyRef.current;
    if (!cy) return;

    const nodes = cy.nodes('.topology-node:selected');
    const box = groupBoxAround(nodes.map(node => node.position()));
    if (!box) return;

    const memberLayouts = new Map<string, NodeLayout>(
      nodes.map(node => [
        node.id(),
        {position: node.position(), groupId: null},
      ]),
    );

    const groupId = topologyStore.manager.addGroup(
      {
        name: `Group ${groupsRef.current.length + 1}`,
        position: {x: box.x, y: box.y},
        width: box.width,
        height: box.height,
      },
      memberLayouts,
    );
    if (groupId === null) return;

    cy.elements().unselect();
    graphSelection.setLayers([groupId], []);
    graphSelection.setRenamingGroup(groupId);
  }

  function onUngroup() {
    if (graphSelection.groupIds.length === 0) return;

    topologyStore.manager.removeGroups(graphSelection.groupIds);
    graphSelection.setGroups([]);
  }

  function onAddToGroup(groupId: string) {
    const cy = cyRef.current;
    const group = groupsRef.current.find(group => group.id === groupId);
    if (!cy || !group) return;

    const nodes = cy.nodes('.topology-node:selected');
    const nodeLayouts = new Map<string, NodeLayout>(
      nodes.map(node => [node.id(), {position: node.position(), groupId}]),
    );
    const grownBox = growGroupBox(
      group,
      nodes.map(node => node.position()),
    );

    topologyStore.manager.updateLayout({
      nodes: nodeLayouts,
      groups: boxUpdates(new Map([[groupId, grownBox]])),
    });
  }

  function onStyle(style: Partial<AnnotationStyle>) {
    const groupIds = graphSelection.groupIds;
    const shapeIds = graphSelection.shapeIds;

    graphSelection.setStylePreview([], null);
    topologyStore.manager.updateLayout({
      groups: new Map(groupIds.map(id => [id, groupStyleUpdate(style)])),
      shapes: new Map(shapeIds.map(id => [id, shapeStyleUpdate(style)])),
    });
  }

  /**
   * Groups lose the given fields, so they use the default style, and shapes get
   * the style they are drawn with.
   */
  function onResetStyle(fields: (keyof AnnotationStyle)[]) {
    const shapeUpdates = new Map(
      selectedShapes().map(shape => {
        const defaults = defaultStyle(shape.annotation.shapeType);

        return [
          shape.id,
          shapeStyleUpdate(
            Object.fromEntries(fields.map(field => [field, defaults[field]])),
          ),
        ];
      }),
    );

    topologyStore.manager.updateLayout({
      groups: new Map(
        graphSelection.groupIds.map(id => [id, groupStyleReset(fields)]),
      ),
      shapes: shapeUpdates,
    });
  }

  function onStylePreview(style: Partial<AnnotationStyle> | null) {
    graphSelection.setStylePreview(graphSelection.layerIds, style);
  }

  // Changes a rectangle to an ellipse and back, or swaps the ends of a line
  function onChangeShape(shapeId: string) {
    const item = findLayerItem(shapeId);
    if (item?.kind !== 'shape') return;

    const annotation = item.shape.annotation;
    const geometry = shapeGeometry(annotation);
    const update: Partial<FreeShapeAnnotation> =
      annotation.shapeType === 'line'
        ? {position: geometry.endPosition, endPosition: geometry.position}
        : {
            shapeType:
              annotation.shapeType === 'rectangle' ? 'circle' : 'rectangle',
          };

    topologyStore.manager.updateLayout({shapes: new Map([[shapeId, update]])});
  }

  function onGroupRename(name: string, isImplicit: boolean) {
    const groupId = graphSelection.renamingGroupId;
    if (!groupId) return null;

    if (name.trim() === '') {
      if (isImplicit) {
        graphSelection.setRenamingGroup(null);
        return null;
      }

      return "Group name can't be empty";
    }

    graphSelection.setRenamingGroup(null);
    topologyStore.manager.updateLayout({
      groups: new Map([[groupId, {name: name.trim()}]]),
    });
    return null;
  }

  function onResize(id: string, box: Box, isFinal: boolean) {
    const item = findLayerItem(id);

    if (item?.kind === 'group') {
      onResizeGroup(item.group, box, isFinal);
    } else if (item && isFinal) {
      topologyStore.manager.updateLayout({
        shapes: boxUpdates(new Map([[id, box]])),
      });
    }
  }

  /**
   * Moves the members of the resized group together, so they stay inside its
   * new box while it is resized. Members that still don't fit are moved to its
   * edge. The box and the members are saved once it ends.
   */
  function onResizeGroup(group: GraphGroup, box: Box, isFinal: boolean) {
    const cy = cyRef.current;
    if (!cy) return;

    resizeMemberStarts.current ??= new Map(
      group.memberIds.map(nodeId => [
        nodeId,
        {...cy.getElementById(nodeId).position()},
      ]),
    );

    const starts = resizeMemberStarts.current;
    const content = groupBoxAround([...starts.values()]);
    const delta = content ? shiftIntoBox(box, content) : {x: 0, y: 0};

    const nodeLayouts = new Map<string, NodeLayout>();
    for (const [nodeId, start] of starts) {
      nodeLayouts.set(nodeId, {
        position: fitIntoGroupBox(box, {
          x: start.x + delta.x,
          y: start.y + delta.y,
        }),
        groupId: group.id,
      });
    }

    cy.batch(() => {
      for (const [nodeId, layout] of nodeLayouts) {
        cy.getElementById(nodeId).position(layout.position);
      }
    });

    if (!isFinal) return;

    resizeMemberStarts.current = null;
    topologyStore.manager.updateLayout({
      nodes: nodeLayouts,
      groups: boxUpdates(new Map([[group.id, box]])),
    });
  }

  function onFitGraph() {
    graphRef.current?.fit(true);
  }

  // The zoom buttons zoom around the center of the visible graph
  function zoomTo(level: number) {
    const cy = cyRef.current;
    if (!cy) return;

    cy.zoom({
      level,
      renderedPosition: {x: cy.width() / 2, y: cy.height() / 2},
    });
  }

  // New nodes from the toolbar are placed in the middle of the visible graph
  function onAddNode() {
    const extent = cyRef.current?.extent();
    if (!extent) return;

    addNodeAt({x: (extent.x1 + extent.x2) / 2, y: (extent.y1 + extent.y2) / 2});
  }

  function addNodeAt(position: Position) {
    const cy = cyRef.current;
    if (!cy) return;

    const occupied = new OccupiedPositions(
      cy.nodes('.topology-node').map(node => node.position()),
    );

    props.onAddNode(occupied.findFreePosition(position));
  }

  function onClearGraph() {
    graphSelection.setLayers([], []);
    topologyStore.manager.clear();
  }

  /**
   * Writes the layout of all nodes into the topology.
   */
  function onSaveGraph() {
    const cy = cyRef.current;
    if (!cy || !topologyStore.manager.topology) return;

    const groupIds = currentGroupIds();
    const nodeLayouts = new Map<string, NodeLayout>();

    for (const node of cy.nodes('.topology-node')) {
      nodeLayouts.set(node.id(), {
        position: node.position(),
        groupId: groupIds.get(node.id()) ?? null,
      });
    }

    if (nodeLayouts.size === 0) return;

    topologyStore.manager.updateLayout({nodes: nodeLayouts});
  }

  function currentGroupIds(): Map<string, string> {
    return new Map(
      groupsRef.current.flatMap(group =>
        group.memberIds.map(nodeId => [nodeId, group.id] as const),
      ),
    );
  }

  function boxOf(group: GraphGroup): Box {
    return graphSelection.groupPreviews.get(group.id) ?? group;
  }

  function exitConnectionMode() {
    nodeConnectionSource.current = null;

    const cy = cyRef.current;
    if (!cy || cy.getElementById(GHOST_NODE_ID).empty()) return;

    cy.remove(`.${GHOST_NODE_ID}`);
    cy.remove(`.${GHOST_EDGE_ID}`);
  }

  // The children don't render again with the editor, unless what they show changed
  const callbacks = useStableCallbacks({
    getCy: () => cyRef.current,
    onGroupRename,
    onGroupSelection,
    onStyle,
    onStylePreview,
    onResetStyle,
    onBringToFront: () => onReorder(true),
    onSendToBack: () => onReorder(false),
    onUngroup,
    onDeleteSelection,
    onResize,
    onLineEndPointerDown,
    onZoomIn: () => zoomTo((cyRef.current?.zoom() ?? 1) * ZOOM_STEP),
    onZoomOut: () => zoomTo((cyRef.current?.zoom() ?? 1) / ZOOM_STEP),
    onZoomReset: () => zoomTo(1),
    onAddNode,
    onFitGraph,
    onToggleStabilization: () => simulationConfig.togglePanel(),
    onStabilizeGraph,
    onContextMenuHide: () => graphSelection.setContextMenuOpen(false),
  });

  return (
    <div
      className="sb-node-editor"
      ref={containerRef}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseDownCapture={onMouseDownCapture}
    >
      <TopologyGraph
        ref={graphRef}
        elements={elements}
        fitKey={props.openTopology?.id ?? null}
        events={{
          click: onGraphClick,
          'click node': onNodeClick,
          'click edge': onEdgeClick,
          tap: onTap,
          tapstart: onGraphPointerDown,
          'tapstart node': onNodePointerDown,
          dbltap: onGraphDoubleClick,
          'dbltap node': onNodeDoubleClick,
          cxttap: onGraphContext,
          'cxttap node': onNodeContext,
          'cxttap edge': onEdgeContext,
          'dragfree node': onDragEnd,
          'drag node': onNodeDrag,
        }}
        onInstance={onInstance}
        underlay={<AnnotationLayer items={layerItems} state={graphSelection} />}
        overlay={
          <GroupRename groups={groups} onRename={callbacks.onGroupRename} />
        }
      />
      <SelectionOverlay
        getCy={callbacks.getCy}
        layerItems={layerItems}
        onGroup={callbacks.onGroupSelection}
        onStyle={callbacks.onStyle}
        onStylePreview={callbacks.onStylePreview}
        onResetStyle={callbacks.onResetStyle}
        onBringToFront={callbacks.onBringToFront}
        onSendToBack={callbacks.onSendToBack}
        onUngroup={callbacks.onUngroup}
        onDelete={callbacks.onDeleteSelection}
        onResize={callbacks.onResize}
        onLineEndPointerDown={callbacks.onLineEndPointerDown}
      />
      <ZoomControl
        onZoomIn={callbacks.onZoomIn}
        onZoomOut={callbacks.onZoomOut}
        onReset={callbacks.onZoomReset}
      />
      <NodeToolbar
        onAddNode={callbacks.onAddNode}
        onFitGraph={callbacks.onFitGraph}
        onGroupSelection={callbacks.onGroupSelection}
        onToggleStabilization={callbacks.onToggleStabilization}
      />
      <SimulationPanel onStabilizeGraph={callbacks.onStabilizeGraph} />
      <ContextMenu
        model={contextMenuModel ?? undefined}
        ref={contextMenuRef}
        onHide={callbacks.onContextMenuHide}
      />
    </div>
  );
});

function isTextInput(target: EventTarget | null) {
  return !!(target as HTMLElement | null)?.closest?.(
    'input, textarea, [contenteditable="true"]',
  );
}

function drawHint(
  shapeType: FreeShapeAnnotation['shapeType'],
  geometry: ShapeGeometry,
) {
  if (shapeType === 'line') {
    return 'Hold Shift to draw horizontally or vertically';
  }

  const box = shapeBox(geometry);
  const size = `${Math.round(box.width)} × ${Math.round(box.height)}`;

  return `${size} · Hold Shift for a ${shapeType === 'circle' ? 'circle' : 'square'}`;
}

function boxUpdates(
  boxes: Map<string, Box>,
): Map<string, {position: Position; width: number; height: number}> {
  return new Map(
    [...boxes].map(([id, box]) => [
      id,
      {
        position: roundPosition(box),
        width: roundCoordinate(box.width),
        height: roundCoordinate(box.height),
      },
    ]),
  );
}

export default NodeEditor;
