import React, {
  MouseEvent,
  SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {EventObject} from 'cytoscape';
import cytoscape, {EdgeSingular, NodeSingular} from 'cytoscape';
// @ts-expect-error This library does not have a type declaration
import coseBilkent from 'cytoscape-cose-bilkent';
import {autorun} from 'mobx';
import {observer} from 'mobx-react-lite';

import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';

import AnnotationLayer from '@sb/components/common/topology-graph/annotation-layer/annotation-layer';
import TextLayer from '@sb/components/common/topology-graph/text-layer/text-layer';
import TopologyGraph, {
  TopologyGraphRef,
} from '@sb/components/common/topology-graph/topology-graph';
import EdgeHalo from '@sb/components/editor-page/topology-editor/node-editor/edge-halo/edge-halo';
import {
  graphMenu,
  groupMenu,
  linkMenu,
  nodeMenu,
  selectionMenu,
  shapeMenu,
  textMenu,
} from '@sb/components/editor-page/topology-editor/node-editor/graph-context-menus';
import LabelEditor from '@sb/components/editor-page/topology-editor/node-editor/label-editor/label-editor';
import LineHandles, {
  LineEnd,
} from '@sb/components/editor-page/topology-editor/node-editor/line-handles/line-handles';
import MoveableHandles, {
  MoveableHandlesRef,
} from '@sb/components/editor-page/topology-editor/node-editor/moveable-handles/moveable-handles';
import SelectionLayer, {
  SelectionLayerRef,
} from '@sb/components/editor-page/topology-editor/node-editor/selection-layer/selection-layer';
import SelectionOverlay from '@sb/components/editor-page/topology-editor/node-editor/selection-overlay/selection-overlay';
import {
  GraphTool,
  HintPart,
  LabelEdit,
  LabelKind,
  TOOL_DRAW_KINDS,
  useGraphSelection,
} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  annotationBoxes,
  AnnotationItem,
  Box,
  boxBetween,
  containsBox,
  containsPoint,
  DrawKind,
  drawnShapeGeometry,
  fitIntoGroupBox,
  GraphGroup,
  GraphShape,
  GraphText,
  groupAt,
  groupBoxAround,
  GroupHitPart,
  groupLabelInset,
  growGroupBox,
  hitTestLayers,
  LayerHit,
  moveShapeGeometry,
  placedGeometry,
  readGraphTexts,
  roundCoordinate,
  roundPosition,
  scaleTransform,
  SelectionTransform,
  shapeBox,
  ShapeGeometry,
  shapeGeometry,
  shiftIntoBox,
  textAt,
  textBox,
  transformShapeGeometry,
  translateTransform,
} from '@sb/lib/graph/annotation-geometry';
import {
  AnnotationStyle,
  defaultStyle,
  groupStyle,
  groupStyleReset,
  groupStyleUpdate,
  newShapeStyle,
  shapeStyleUpdate,
} from '@sb/lib/graph/annotation-style';
import {
  boundsToBox,
  generateGraph,
  generateGroups,
  generateLayerItems,
  toGraphPosition,
} from '@sb/lib/graph/cytoscape-utils';
import {
  clipboardBox,
  createClipboard,
  GraphClipboard,
  parseClipboard,
  pasteClipboard,
} from '@sb/lib/graph/graph-clipboard';
import {GraphAction, matchGraphKeybind} from '@sb/lib/graph/graph-keybinds';
import {
  validateInterfaceName,
  validateNodeName,
} from '@sb/lib/graph/label-validation';
import {GRID_SPACING, OccupiedPositions} from '@sb/lib/graph/placement';
import {findNodeAnnotation} from '@sb/lib/graph/topology-annotations';
import {NodeLayout} from '@sb/lib/graph/topology-graph';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';
import {GraphSelectionSnapshot} from '@sb/lib/topology-history';
import {useStableCallbacks} from '@sb/lib/utils/hooks';
import {
  FreeShapeAnnotation,
  FreeTextAnnotation,
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

/**
 * The selected elements as they were when the selection started to move or to
 * be resized.
 */
interface SelectionStarts {
  boxes: Map<string, Box>;
  shapes: Map<string, ShapeGeometry>;
  texts: Map<string, Pick<FreeTextAnnotation, 'position' | 'width' | 'height'>>;
  memberPositions: Map<string, Position>;

  // The moved nodes that move on their own, they can join, leave and grow groups
  nodeIds: string[];
}

type PointerAction =
  | {
      kind: 'select-box';
      origin: Position;
      originClient: Position;
      isAdditive: boolean;
      hasMoved: boolean;
    }
  | ({
      kind: 'move-layers';
      origin: Position;
      originClient: Position;
      pointer: Position;
      hasMoved: boolean;
    } & SelectionStarts)
  | {
      kind: 'draw';
      drawKind: DrawKind;
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

  // Groups that nodes are added to, they only grow once the nodes are dropped
  joinedGroupIds: Set<string>;
  hint: HintPart[] | null;
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
  const moveableHandlesRef = useRef<MoveableHandlesRef>(null);
  const selectionLayerRef = useRef<SelectionLayerRef>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const nodeConnectionSource = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<ContextMenu | null>(null);
  const menuTargetRef = useRef<string | null>(null);
  // Position in the graph where the context menu of the graph was opened
  const contextMenuPosition = useRef<Position>({x: 0, y: 0});
  const pointerAction = useRef<PointerAction | null>(null);
  const isDragCtrl = useRef(false);
  const moveFrame = useRef(0);

  // Positions of the members of a resized group from before it was resized
  const resizeMemberStarts = useRef<Map<string, Position> | null>(null);
  const selectionResizeStarts = useRef<SelectionStarts | null>(null);

  /*
   * The targets of the last two taps. Cytoscape emits a double tap for any two
   * taps in quick succession, so it only counts if both taps hit the same target.
   */
  const tapTargets = useRef<[string | null, string | null]>([null, null]);
  // Whether the graph was the last part of the page that was clicked
  const isGraphActive = useRef(false);

  /*
   * The elements copied last. The menus use them instead of the clipboard of
   * the system, which they can't read or write without a secure context.
   */
  const copiedElements = useRef<GraphClipboard | null>(null);

  // Pasted elements are selected once the graph shows them

  // Where the pointer was last, elements pasted with the keyboard are placed there
  const lastPointer = useRef<Position | null>(null);

  // The text the last press was on, as the graph didn't get the press
  const pressedTextId = useRef<string | null>(null);

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

  const texts = useMemo(
    () =>
      readGraphTexts(props.openTopology?.annotations.freeTextAnnotations ?? []),
    [props.openTopology?.annotations],
  );

  const annotationItems = useMemo<AnnotationItem[]>(
    () => [
      ...layerItems,
      ...texts.map(text => ({kind: 'text' as const, id: text.id, text})),
    ],
    [layerItems, texts],
  );

  // The handlers below are registered once, they reach the current state through these refs
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const layerItemsRef = useRef(layerItems);
  layerItemsRef.current = layerItems;

  const textsRef = useRef(texts);
  textsRef.current = texts;

  const handlersRef = useRef({
    onKeyDown,
    onKeyUp,
    onPointerMove,
    onPointerUp,
    onClipboard,
  });
  handlersRef.current = {
    onKeyDown,
    onKeyUp,
    onPointerMove,
    onPointerUp,
    onClipboard,
  };

  useEffect(() => {
    const onMouseDownCapture = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      isGraphActive.current =
        !!containerRef.current?.contains(target) ||
        !!target?.closest?.('.p-contextmenu, .sb-selection-popover');

      // The menu only closes on a click on its own, which a press of the middle button isn't
      if (!target?.closest?.('.p-contextmenu')) hideContextMenu();
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

    const onClipboard = (event: ClipboardEvent) =>
      handlersRef.current.onClipboard(event);
    document.addEventListener('copy', onClipboard);
    document.addEventListener('cut', onClipboard);
    document.addEventListener('paste', onClipboard);

    return () => {
      window.removeEventListener('mousedown', onMouseDownCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onClipboard);
      document.removeEventListener('cut', onClipboard);
      document.removeEventListener('paste', onClipboard);
    };
  }, []);

  useEffect(
    () =>
      autorun(() => {
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
    graphSelection.clear();
    graphSelection.setLabelEdit(null);
    graphSelection.setPendingSelection(null);
  }, [props.openTopology?.id]);

  useEffect(() => {
    const pending = graphSelection.pendingSelection;
    const cy = cyRef.current;
    if (!pending || !cy) return;

    // The definition and the annotations can arrive one after the other
    const annotationIds = new Set([
      ...groups.map(group => group.id),
      ...layerItems.map(item => item.id),
      ...texts.map(text => text.id),
    ]);
    const isShown =
      pending.nodeIds.every(nodeId => cy.getElementById(nodeId).nonempty()) &&
      [...pending.groupIds, ...pending.shapeIds, ...pending.textIds].every(id =>
        annotationIds.has(id),
      );
    if (!isShown) return;

    graphSelection.setPendingSelection(null);
    graphSelection.select(pending);
  }, [elements]);

  // The label that is edited is hidden in the graph, the field takes its place
  useEffect(
    () =>
      autorun(() => {
        const labelEdit = graphSelection.labelEdit;
        const cy = cyRef.current;
        if (!cy) return;

        cy.elements().removeClass('renaming renaming-source renaming-target');
        if (!labelEdit || labelEdit.kind === LabelKind.Group) return;

        cy.getElementById(labelEdit.id).addClass(
          labelEdit.kind === LabelKind.Node
            ? 'renaming'
            : labelEdit.endpointIndex === 0
              ? 'renaming-source'
              : 'renaming-target',
        );
      }),
    [],
  );

  // Elements that were removed, e.g. by undo, are removed from the selection
  useEffect(() => {
    graphSelection.retain(
      new Set([
        ...(cyRef.current?.nodes('.topology-node').map(node => node.id()) ??
          []),
        ...layerItems.map(item => item.id),
        ...texts.map(text => text.id),
      ]),
    );
  }, [layerItems, texts]);

  function onInstance(cy: cytoscape.Core) {
    cyRef.current = cy;

    /*
     * Nodes are selected and moved by the editor, together with the rest of the
     * selection. Panning stays enabled, as cytoscape only zooms with the mouse
     * wheel while it is, it is paused while elements are moved.
     */
    cy.boxSelectionEnabled(false);
    cy.autounselectify(true);
    cy.autoungrabify(true);

    let frame = 0;
    let zoom = cy.zoom();
    const onViewport = () => {
      // The handles and the outlines follow the graph in the same frame
      moveableHandlesRef.current?.updateRect();
      if (cy.zoom() !== zoom) {
        zoom = cy.zoom();
        selectionLayerRef.current?.draw();
      }

      // The menu belongs to the place in the graph it was opened at
      hideContextMenu();

      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        graphSelection.setZoom(cy.zoom());
      });
    };
    graphSelection.setZoom(cy.zoom());

    // Moved nodes are drawn by cytoscape in the next frame, their outlines are too
    let positionFrame = 0;
    const onPosition = () => {
      if (positionFrame) return;
      positionFrame = requestAnimationFrame(() => {
        positionFrame = 0;
        selectionLayerRef.current?.draw();
      });
    };

    cy.on('viewport', onViewport);
    cy.on('position', 'node', onPosition);

    return () => {
      cy.off('viewport', onViewport);
      cy.off('position', 'node', onPosition);
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
      case GraphAction.TextTool:
        graphSelection.setTool(GraphTool.Text);
        break;
      case GraphAction.GroupTool:
        graphSelection.setTool(GraphTool.Group);
        break;
      case GraphAction.Duplicate:
        onDuplicate();
        break;
      case GraphAction.Rename:
        onRenameSelection();
        break;
      case GraphAction.EditText:
        if (graphSelection.count === 1 && graphSelection.textIds.length === 1) {
          graphSelection.setEditingText(graphSelection.textIds[0]);
        }
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
   * Shapes and texts are placed over everything, nodes included, and texts are
   * pressed before the nodes below them. These presses don't reach the graph,
   * so they don't select or move anything in it.
   */
  function onMouseDownCapture(event: MouseEvent<HTMLDivElement>) {
    const cy = cyRef.current;
    pressedTextId.current = null;

    if (
      !cy ||
      graphSelection.isHandActive ||
      !cy.container()?.contains(event.target as Node)
    ) {
      return;
    }

    const position = toGraphPosition(cy, event.clientX, event.clientY);
    const drawKind = TOOL_DRAW_KINDS.get(graphSelection.tool);

    if (drawKind && graphSelection.isDrawToolActive) {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      graphSelection.setPointerDown(true);
      pointerAction.current = {
        kind: 'draw',
        drawKind,
        origin: position,
        originClient: {x: event.clientX, y: event.clientY},
        hasMoved: false,
      };
      return;
    }

    const text = textAt(textsRef.current, graphSelection.textSizes, position);
    if (!text) return;

    event.stopPropagation();
    pressedTextId.current = text.id;
    if (event.button !== 0) return;

    event.preventDefault();

    if ((event.ctrlKey || event.metaKey) && openLinkAt(text.id, event)) return;

    graphSelection.setPointerDown(true);
    onAnnotationPointerDown(
      {kind: 'text', id: text.id, text},
      position,
      {x: event.clientX, y: event.clientY},
      event.shiftKey,
    );
  }

  // Opens the link of the text at the position of the pointer, if there is one
  function openLinkAt(textId: string, event: MouseEvent) {
    const link = [
      ...(containerRef.current?.querySelectorAll<HTMLAnchorElement>(
        `[data-layer-id="${CSS.escape(textId)}"] a`,
      ) ?? []),
    ].find(link =>
      [...link.getClientRects()].some(
        rect =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      ),
    );
    if (!link) return false;

    window.open(link.href, '_blank', 'noopener,noreferrer');
    return true;
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const cy = cyRef.current;
    if (
      !cy ||
      graphSelection.isHandActive ||
      !cy.container()?.contains(event.target as Node)
    ) {
      return;
    }

    const text = textAt(
      textsRef.current,
      graphSelection.textSizes,
      toGraphPosition(cy, event.clientX, event.clientY),
    );
    if (text) graphSelection.setEditingText(text.id);
  }

  // The context menu of a text, the press on it didn't reach the graph
  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const textId = pressedTextId.current;
    pressedTextId.current = null;
    if (!textId || !contextMenuRef.current) return;

    event.preventDefault();

    if (!graphSelection.textIds.includes(textId)) {
      graphSelection.select({textIds: [textId]});
    }

    menuTargetRef.current = textId;
    setContextMenuModel(
      graphSelection.count > 1
        ? currentSelectionMenu()
        : textMenu({
            ...clipboardActions,
            onEdit: () => graphSelection.setEditingText(textId),
            onBringToFront: () => onReorder(true),
            onSendToBack: () => onReorder(false),
            onDelete: onDeleteSelection,
          }),
    );
    showContextMenu(event);
  }

  // An unchanged text is left as it is, unless it is empty and is removed
  function onTextEditEnd(textId: string, value: string) {
    graphSelection.setEditingText(null);

    const text = textsRef.current.find(text => text.id === textId);
    if (!text || (text.annotation.text === value && value.trim() !== '')) {
      return;
    }

    topologyStore.manager.setText(textId, value);
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
      if (!mouseEvent.shiftKey) graphSelection.clear();

      pointerAction.current = {
        kind: 'select-box',
        origin: event.position,
        originClient,
        isAdditive: mouseEvent.shiftKey,
        hasMoved: false,
      };
      return;
    }

    onAnnotationPointerDown(
      hit.kind === 'group'
        ? {kind: 'group', id: hit.group.id, group: hit.group}
        : {kind: 'shape', id: hit.shape.id, shape: hit.shape},
      event.position,
      originClient,
      mouseEvent.shiftKey,
    );
  }

  /**
   * Selects the pressed annotation, shift adds or removes it, and starts moving
   * the selected annotations.
   */
  function onAnnotationPointerDown(
    item: AnnotationItem,
    position: Position,
    originClient: Position,
    isShift: boolean,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    if (isShift) {
      if (item.kind === 'group') graphSelection.toggleGroup(item.id);
      if (item.kind === 'shape') graphSelection.toggleShape(item.id);
      if (item.kind === 'text') graphSelection.toggleText(item.id);
    } else if (!graphSelection.annotationIds.includes(item.id)) {
      graphSelection.select(itemSelection(item.kind, item.id));
    }

    startMove(position, originClient, null);
  }

  /**
   * Starts moving the selection. The pressed node moves with it, even if it
   * isn't selected yet.
   */
  function startMove(
    position: Position,
    originClient: Position,
    pressedNodeId: string | null,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    pointerAction.current = {
      kind: 'move-layers',
      origin: position,
      originClient,
      pointer: position,
      hasMoved: false,
      ...selectionStarts(cy, pressedNodeId),
    };
  }

  function selectionStarts(
    cy: cytoscape.Core,
    pressedNodeId: string | null,
  ): SelectionStarts {
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

    // Nodes that move with their group stay in it
    const nodeIds = [
      ...new Set([
        ...graphSelection.nodeIds,
        ...(pressedNodeId ? [pressedNodeId] : []),
      ]),
    ].filter(nodeId => !memberPositions.has(nodeId));

    for (const nodeId of nodeIds) {
      memberPositions.set(nodeId, {...cy.getElementById(nodeId).position()});
    }

    return {
      boxes: new Map(movedGroups.map(group => [group.id, boxOf(group)])),
      shapes: new Map(
        selectedShapes().map(shape => [
          shape.id,
          shapeGeometry(shape.annotation),
        ]),
      ),
      texts: new Map(
        selectedTexts().map(text => [
          text.id,
          {
            position: text.annotation.position,
            width: text.annotation.width,
            height: text.annotation.height,
          },
        ]),
      ),
      memberPositions,
      nodeIds,
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

  function selectedTexts(): GraphText[] {
    return textsRef.current.filter(text =>
      graphSelection.textIds.includes(text.id),
    );
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
    lastPointer.current = {x: event.clientX, y: event.clientY};
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
        action.drawKind,
        action.origin,
        position,
        event.shiftKey,
      );

      graphSelection.setDrawPreview({kind: action.drawKind, geometry});
      graphSelection.setDrag(
        drawHint(action.drawKind, geometry),
        null,
        new Map(),
      );
      return;
    }

    if (action.kind === 'select-box') {
      if (!isBeyondThreshold && !action.hasMoved) return;

      action.hasMoved = true;
      graphSelection.setInteracting(true);
      graphSelection.setSelectionBox(boxBetween(action.origin, position));
      return;
    }

    if (!isBeyondThreshold && !action.hasMoved) return;

    if (!action.hasMoved) exitConnectionMode();

    action.hasMoved = true;
    action.pointer = position;
    isDragCtrl.current = event.ctrlKey || event.metaKey;
    graphSelection.setInteracting(true);
    graphSelection.setMoving(true);

    /*
     * The members move right away, cytoscape draws them in its own animation
     * frame, which runs before the one requested here. The boxes are rendered
     * by React, so they only change once per frame.
     */
    transformNodes(action, moveTransform(action));

    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;

      const action = pointerAction.current;
      if (action?.kind === 'move-layers') {
        transformPreviews(action, moveTransform(action));
      }
    });
  }

  function moveTransform(action: MoveLayersAction) {
    return translateTransform({
      x: action.pointer.x - action.origin.x,
      y: action.pointer.y - action.origin.y,
    });
  }

  /**
   * Moves the nodes of the selection right away. The members of resized groups
   * are kept inside them, like when a single group is resized.
   */
  function transformNodes(
    starts: SelectionStarts,
    transform: SelectionTransform,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    const boxes = transformedGroupBoxes(starts, transform);
    const groupIds = currentGroupIds();

    cy.batch(() => {
      for (const [nodeId, start] of starts.memberPositions) {
        const groupId = groupIds.get(nodeId) ?? '';
        const box = boxes.get(groupId);
        const startBox = starts.boxes.get(groupId);
        const position = transform.position(start);

        cy.getElementById(nodeId).position(
          box &&
            startBox &&
            (box.width !== startBox.width || box.height !== startBox.height)
            ? fitIntoGroupBox(box, position)
            : position,
        );
      }
    });
  }

  // Groups with members don't get smaller than a group around a single node
  function transformedGroupBoxes(
    starts: SelectionStarts,
    transform: SelectionTransform,
  ): Map<string, Box> {
    const minBox = groupBoxAround([{x: 0, y: 0}])!;
    const hasMembers = new Set(
      groupsRef.current
        .filter(group => group.memberIds.length > 0)
        .map(group => group.id),
    );

    return new Map(
      [...starts.boxes].map(([id, start]) => {
        const box = transform.box(start);
        if (!hasMembers.has(id)) return [id, box];

        return [
          id,
          {
            ...box,
            width: Math.max(box.width, minBox.width),
            height: Math.max(box.height, minBox.height),
          },
        ];
      }),
    );
  }

  function transformText(
    start: Pick<FreeTextAnnotation, 'position' | 'width' | 'height'>,
    transform: SelectionTransform,
  ): Partial<FreeTextAnnotation> {
    const box = transform.box({
      ...start.position,
      width: start.width ?? 0,
      height: start.height ?? 0,
    });

    return {
      position: roundPosition(box),
      ...(start.width !== undefined ? {width: roundCoordinate(box.width)} : {}),
      ...(start.height !== undefined
        ? {height: roundCoordinate(box.height)}
        : {}),
    };
  }

  function transformPreviews(
    starts: SelectionStarts,
    transform: SelectionTransform,
  ) {
    const plan = planSelectionDrop(starts);

    graphSelection.setDrag(
      plan.hint,
      plan.dropTargetId,
      new Map([
        ...transformedGroupBoxes(starts, transform),
        ...[...plan.groupBoxes].filter(([id]) => !plan.joinedGroupIds.has(id)),
      ]),
    );
    graphSelection.setShapePreviews(
      new Map(
        [...starts.shapes].map(([id, geometry]) => [
          id,
          transformShapeGeometry(geometry, transform),
        ]),
      ),
    );
    graphSelection.setTextPreviews(
      new Map(
        [...starts.texts].map(([id, start]) => [
          id,
          transformText(start, transform),
        ]),
      ),
    );
  }

  /**
   * Saves the moved or resized selection. The members of moved groups stay in
   * them, the other nodes are dropped like dragged nodes.
   */
  function commitTransform(
    starts: SelectionStarts,
    transform: SelectionTransform,
    mergeKey?: string,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    transformNodes(starts, transform);

    const plan = planSelectionDrop(starts);
    isDragCtrl.current = false;

    const memberGroupIds = currentGroupIds();
    const nodeLayouts = new Map<string, NodeLayout>();
    for (const nodeId of starts.memberPositions.keys()) {
      nodeLayouts.set(nodeId, {
        position: cy.getElementById(nodeId).position(),
        groupId: plan.groupIds.has(nodeId)
          ? (plan.groupIds.get(nodeId) ?? null)
          : (memberGroupIds.get(nodeId) ?? null),
      });
    }

    graphSelection.clearDrag();
    topologyStore.manager.updateLayout(
      {
        nodes: nodeLayouts,
        groups: new Map([
          ...boxUpdates(transformedGroupBoxes(starts, transform)),
          ...boxUpdates(plan.groupBoxes),
        ]),
        shapes: new Map(
          [...starts.shapes].map(([id, geometry]) => [
            id,
            transformShapeGeometry(geometry, transform),
          ]),
        ),
        texts: new Map(
          [...starts.texts].map(([id, start]) => [
            id,
            transformText(start, transform),
          ]),
        ),
      },
      mergeKey,
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
    graphSelection.setMoving(false);

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
    commitTransform(action, moveTransform(action));
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
      action.drawKind,
      action.origin,
      position,
      isShift,
    );
    const box = shapeBox(drawn);
    const isLargeEnough =
      action.drawKind === 'line'
        ? Math.max(box.width, box.height) >= MIN_SHAPE_SIZE
        : Math.min(box.width, box.height) >= MIN_SHAPE_SIZE;

    const geometry =
      action.hasMoved && isLargeEnough
        ? drawn
        : placedGeometry(action.drawKind, roundPosition(action.origin));

    addAnnotation(action.drawKind, geometry);
  }

  // Adds a shape of the default size centered on the given position
  function addAnnotationAt(drawKind: DrawKind, position: Position) {
    const geometry = placedGeometry(drawKind, position);
    const box = shapeBox(geometry);

    addAnnotation(
      drawKind,
      moveShapeGeometry(geometry, {x: -box.width / 2, y: -box.height / 2}),
    );
  }

  // Adds a drawn shape, text or group and selects it, a text or group is named right away
  function addAnnotation(drawKind: DrawKind, geometry: ShapeGeometry) {
    if (drawKind === 'group') {
      const box = shapeBox(geometry);
      const name = `Group ${groupsRef.current.length + 1}`;
      const groupId = topologyStore.manager.addGroup(
        {
          name,
          position: geometry.position,
          width: box.width,
          height: box.height,
        },
        new Map(),
      );
      if (groupId === null) return;

      graphSelection.select({groupIds: [groupId]});
      startGroupRename({id: groupId, name, annotation: null, ...box});
      return;
    }

    if (drawKind === 'text') {
      const textId = topologyStore.manager.addText({text: '', ...geometry});
      if (textId === null) return;

      graphSelection.select({textIds: [textId]});
      graphSelection.setEditingText(textId);
      return;
    }

    const shapeId = topologyStore.manager.addShape({
      shapeType: drawKind,
      ...geometry,
      ...newShapeStyle(drawKind),
    });
    if (shapeId === null) return;

    graphSelection.select({shapeIds: [shapeId]});
  }

  function selectInBox(box: Box, isAdditive: boolean) {
    const cy = cyRef.current;
    if (!cy) return;

    const nodeIds = cy
      .nodes('.topology-node')
      .filter(node => containsPoint(box, node.position()))
      .map(node => node.id());

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
    const textIds = textsRef.current
      .filter(text => {
        const textBounds = textBox(
          text.annotation,
          graphSelection.textSizes.get(text.id),
        );
        return textBounds !== null && containsBox(box, textBounds);
      })
      .map(text => text.id);

    const selection = {nodeIds, groupIds, shapeIds, textIds};
    if (isAdditive) {
      graphSelection.add(selection);
    } else {
      graphSelection.select(selection);
    }
  }

  function onEdgeClick(event: cytoscape.EventObject) {
    if (!event.target.hasClass(GHOST_EDGE_ID)) return;

    exitConnectionMode();
    graphSelection.clear();
  }

  function onNodeClick(event: cytoscape.EventObject) {
    const node = event.target;
    const nodeId = node.id();

    if (node.hasClass(GHOST_NODE_ID)) {
      exitConnectionMode();
      graphSelection.clear();
      return;
    }

    if (nodeConnectionSource.current && nodeConnectionSource !== nodeId) {
      topologyStore.manager.connectNodes(nodeConnectionSource.current, nodeId);
      exitConnectionMode();
      return;
    }

    if (graphSelection.isHandActive || !node.hasClass('topology-node')) return;

    // Shift adds or removes the node, a click without it selects only the node
    if ((event.originalEvent as unknown as globalThis.MouseEvent)?.shiftKey) {
      graphSelection.toggleNode(nodeId);
    } else {
      graphSelection.select({nodeIds: [nodeId]});
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
    if (!mouseEvent.shiftKey && !graphSelection.nodeIds.includes(node.id())) {
      graphSelection.select({nodeIds: [node.id()]});
    }

    cy.userPanningEnabled(false);
    startMove(
      event.position,
      {x: mouseEvent.clientX, y: mouseEvent.clientY},
      node.id(),
    );
  }

  // A double-click on the icon opens the dialog, on the label it renames the node
  function onNodeDoubleClick(event: cytoscape.EventObject) {
    const node = event.target as NodeSingular;
    if (graphSelection.isHandActive || !isDoubleTapOnSameTarget()) return;

    const bounds = node.boundingBox({
      includeLabels: false,
      includeOverlays: false,
      includeUnderlays: false,
    });

    if (containsPoint(boundsToBox(bounds), event.position)) {
      props.onEditNode(node.id());
    } else {
      startNodeRename(node.id());
    }
  }

  // A double-click on a link renames the interface at the closer end
  function onEdgeDoubleClick(event: cytoscape.EventObject) {
    const edge = event.target as EdgeSingular;
    if (
      edge.hasClass(GHOST_EDGE_ID) ||
      graphSelection.isHandActive ||
      !isDoubleTapOnSameTarget()
    ) {
      return;
    }

    const distanceTo = (position: Position) =>
      Math.hypot(position.x - event.position.x, position.y - event.position.y);

    startInterfaceRename(
      edge.id(),
      distanceTo(edge.sourceEndpoint()) <= distanceTo(edge.targetEndpoint())
        ? 0
        : 1,
    );
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
      startGroupRename(hit.group);
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

    const edge = event.target as EdgeSingular;
    graphSelection.setMenuEdge(edge.id());

    setContextMenuModel(
      linkMenu({
        endpoints: [0, 1].map(
          index =>
            `${edge.data(index === 0 ? 'source' : 'target')}:${edge.data(index === 0 ? 'sourceLabel' : 'targetLabel')}`,
        ) as [string, string],
        onRenameInterface: endpointIndex =>
          startInterfaceRename(edge.id(), endpointIndex),
        onDelete: () =>
          topologyStore.manager.deleteElements(
            [],
            [[edge.data('source'), edge.data('target')]],
            [],
            [],
          ),
      }),
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
        graphSelection.select(itemSelection(hit.kind, hitId));
      }

      menuTargetRef.current = hitId;
      setContextMenuModel(
        graphSelection.count > 1
          ? currentSelectionMenu()
          : hit.kind === 'group'
            ? currentGroupMenu()
            : shapeMenu({
                ...clipboardActions,
                shapeType: hit.shape.annotation.shapeType,
                onChangeShape: () => onChangeShape(hitId),
                onBringToFront: () => onReorder(true),
                onSendToBack: () => onReorder(false),
                onDelete: onDeleteSelection,
              }),
      );
    } else {
      // The menu of the graph isn't about the selection, so it is cleared
      deselectAll();
      setContextMenuModel(
        graphMenu({
          canPaste: !!copiedElements.current || !!navigator.clipboard,
          onAddNode: () => addNodeAt(contextMenuPosition.current),
          onAddAnnotation: kind =>
            addAnnotationAt(kind, contextMenuPosition.current),
          onPaste: () => void onMenuPaste(contextMenuPosition.current),
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

    if (!graphSelection.nodeIds.includes(event.target.id())) {
      graphSelection.select({nodeIds: [event.target.id()]});
    }
    menuTargetRef.current = event.target.id();

    setContextMenuModel(
      graphSelection.count > 1
        ? currentSelectionMenu()
        : nodeMenu({
            ...clipboardActions,
            onRename: () => startNodeRename(event.target.id()),
            onEdit: onNodeEdit,
            onConnect: onNodeConnectStart,
            onDelete: onDeleteSelection,
          }),
    );
    showContextMenu(mouseEvent);
  }

  function hideContextMenu() {
    if (!graphSelection.isContextMenuOpen) return;

    // The event is only passed on to onHide, which doesn't use it
    contextMenuRef.current?.hide(null as unknown as SyntheticEvent);
  }

  // The bar is hidden while the menu is open
  function showContextMenu(event: MouseEvent) {
    graphSelection.setContextMenuOpen(true);
    contextMenuRef.current?.show(event);
  }

  function selectedNodes(cy: cytoscape.Core) {
    const nodeIds = new Set(graphSelection.nodeIds);
    return cy
      .nodes('.topology-node')
      .filter(node => nodeIds.has(node.id()))
      .nodes();
  }

  function currentSelectionMenu() {
    return selectionMenu({
      ...clipboardActions,
      count: graphSelection.count,
      canGroup: graphSelection.nodeIds.length > 0,
      canReorder: graphSelection.layerIds.length > 0,
      onGroup: onGroupSelection,
      onBringToFront: () => onReorder(true),
      onSendToBack: () => onReorder(false),
      onDelete: onDeleteSelection,
    });
  }

  function currentGroupMenu() {
    return groupMenu({
      ...clipboardActions,
      onRename: () => {
        const group = groupsRef.current.find(
          group => group.id === menuTargetRef.current,
        );
        if (group) startGroupRename(group);
      },
      onSelectMembers: onSelectMembers,
      onBringToFront: () => onReorder(true),
      onSendToBack: () => onReorder(false),
      onUngroup: onUngroup,
      onDelete: onDeleteSelection,
    });
  }

  // The nodes that move on their own are dropped like a single dragged node
  function planSelectionDrop(starts: SelectionStarts): DropPlan {
    return planDrop(
      starts.nodeIds,
      starts.nodeIds[0] ?? '',
      isDragCtrl.current,
      new Set(starts.boxes.keys()),
    );
  }

  function planDrop(
    nodeIds: string[],
    targetNodeId: string,
    isCtrl: boolean,
    movedGroupIds: Set<string>,
  ): DropPlan {
    const cy = cyRef.current!;

    // Groups that move along can't be dropped into
    const targetGroups = groupsRef.current.filter(
      group => !movedGroupIds.has(group.id),
    );
    const currentGroups = currentGroupIds();
    const groupIds = new Map<string, string | null>();
    const joinedGroupIds = new Set<string>();
    const includedPositions = new Map<string, Position[]>();

    for (const nodeId of nodeIds) {
      const position = cy.getElementById(nodeId).position();
      const currentGroupId = currentGroups.get(nodeId) ?? null;
      const groupUnder = groupAt(targetGroups, position)?.id ?? null;

      let groupId = currentGroupId;
      if (groupUnder !== null && groupUnder !== currentGroupId) {
        groupId = groupUnder;
      } else if (currentGroupId !== null && isCtrl) {
        groupId = null;
      }

      groupIds.set(nodeId, groupId);
      if (groupId !== null && groupId !== currentGroupId) {
        joinedGroupIds.add(groupId);
      }
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

    const label = nodeIds.length > 1 ? 'the nodes' : 'the node';
    const currentGroupId = currentGroups.get(targetNodeId) ?? null;
    const nextGroupId = groupIds.get(targetNodeId) ?? null;

    let hint: HintPart[] | null = null;
    let dropTargetId: string | null = null;

    if (nextGroupId !== null && nextGroupId !== currentGroupId) {
      hint = [{keyword: 'Drop'}, ` to add ${label} to the group`];
      dropTargetId = nextGroupId;
    } else if (currentGroupId !== null && nextGroupId === null) {
      hint = [{keyword: 'Drop'}, ` to move ${label} out of the group`];
    } else if (currentGroupId !== null) {
      hint = ['Hold ', {keyword: 'Ctrl'}, ` to move ${label} out of the group`];
    }

    return {groupIds, groupBoxes, joinedGroupIds, hint, dropTargetId};
  }

  // Nudged nodes that move on their own grow and join groups like dragged nodes
  function onNudge(delta: Position) {
    const cy = cyRef.current;
    if (!cy || graphSelection.count === 0) return;

    commitTransform(
      selectionStarts(cy, null),
      translateTransform(delta),
      NUDGE_MERGE_KEY,
    );
  }

  /**
   * Copies, cuts or pastes the selection with the clipboard of the system while
   * the graph is active. These events can use the clipboard without a secure
   * context, unlike the menus.
   */
  function onClipboard(event: ClipboardEvent) {
    if (!isGraphActive.current || isTextInput(event.target)) return;

    if (event.type === 'paste') {
      const clipboard = parseClipboard(
        event.clipboardData?.getData('text/plain') ?? '',
      );
      if (!clipboard) return;

      event.preventDefault();
      paste(clipboard, pointerPosition());
      return;
    }

    const clipboard = copySelection();
    if (!clipboard) return;

    event.preventDefault();
    event.clipboardData?.setData('text/plain', JSON.stringify(clipboard));
    copiedElements.current = clipboard;

    if (event.type === 'cut') onDeleteSelection();
  }

  function onMenuCopy() {
    const clipboard = copySelection();
    if (!clipboard) return;

    copiedElements.current = clipboard;

    // Only available in a secure context, otherwise the copy stays in the editor
    void navigator.clipboard
      ?.writeText(JSON.stringify(clipboard))
      .catch(() => {});
  }

  function onMenuCut() {
    onMenuCopy();
    onDeleteSelection();
  }

  async function onMenuPaste(position: Position) {
    const text = await navigator.clipboard?.readText().catch(() => null);
    const clipboard =
      (text ? parseClipboard(text) : null) ?? copiedElements.current;

    if (clipboard) paste(clipboard, position);
  }

  function onDuplicate() {
    const clipboard = copySelection();
    if (clipboard) paste(clipboard, null);
  }

  /**
   * Returns the selected elements to be copied. The members of selected groups
   * are copied with them, links only between copied nodes.
   */
  function copySelection(): GraphClipboard | null {
    const cy = cyRef.current;
    const topology = props.openTopology;
    if (!cy || !topology || graphSelection.count === 0) return null;

    const groups = groupsRef.current.filter(group =>
      graphSelection.groupIds.includes(group.id),
    );
    const nodeNames = new Set([
      ...graphSelection.nodeIds,
      ...groups.flatMap(group => group.memberIds),
    ]);

    // Groups of old topologies don't have an annotation, their members are copied without them
    const copiedGroupIds = new Set(
      groups.filter(group => group.annotation).map(group => group.id),
    );
    const memberGroupIds = currentGroupIds();

    const definition = topology.definition.toJS();
    const links = (definition.topology?.links ?? []).filter(link =>
      link.endpoints.every(endpoint => nodeNames.has(endpoint.split(':')[0])),
    );

    return createClipboard({
      nodes: [...nodeNames].map(nodeName => {
        const groupId = memberGroupIds.get(nodeName);

        return {
          name: nodeName,
          definition: definition.topology?.nodes?.[nodeName] ?? null,
          annotation: {
            ...findNodeAnnotation(topology.annotations, nodeName),
            id: nodeName,
            position: roundPosition(cy.getElementById(nodeName).position()),
            groupId:
              groupId && copiedGroupIds.has(groupId) ? groupId : undefined,
            group: undefined,
            level: undefined,
          },
        };
      }),
      links,
      groups: groups
        .filter(group => group.annotation)
        .map(group => group.annotation!),
      shapes: selectedShapes().map(shape => shape.annotation),
      texts: selectedTexts().map(text => text.annotation),
    });
  }

  /**
   * Adds copied elements to the graph and selects them. They are centered on
   * the given position, or placed one grid step next to the copied elements.
   */
  function paste(clipboard: GraphClipboard, position: Position | null) {
    const cy = cyRef.current;
    const topology = props.openTopology;
    const box = clipboardBox(clipboard);
    if (!cy || !topology || !box) return;

    const delta = position
      ? {
          x: position.x - (box.x + box.width / 2),
          y: position.y - (box.y + box.height / 2),
        }
      : {x: GRID_SPACING, y: GRID_SPACING};

    const pasted = pasteClipboard(
      clipboard,
      cy.nodes('.topology-node').map(node => node.id()),
      topology.annotations,
      roundPosition(delta),
    );

    graphSelection.setPendingSelection({
      nodeIds: pasted.nodes.map(node => node.name),
      groupIds: pasted.groups.map(group => group.id),
      shapeIds: pasted.shapes.map(shape => shape.id),
      textIds: pasted.texts.map(text => text.id),
    });
    topologyStore.manager.pasteElements(pasted);
  }

  // The position of the pointer in the graph, or null if it isn't over the graph
  function pointerPosition(): Position | null {
    const cy = cyRef.current;
    const pointer = lastPointer.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!cy || !pointer || !rect) return null;

    const isOverGraph =
      pointer.x >= rect.left &&
      pointer.x <= rect.right &&
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom;

    return isOverGraph ? toGraphPosition(cy, pointer.x, pointer.y) : null;
  }

  function onSelectAll() {
    graphSelection.select({
      nodeIds: cyRef.current?.nodes('.topology-node').map(node => node.id()),
      groupIds: groupsRef.current.map(group => group.id),
      shapeIds: layerItemsRef.current
        .filter(item => item.kind === 'shape')
        .map(item => item.id),
      textIds: textsRef.current.map(text => text.id),
    });
  }

  function deselectAll() {
    graphSelection.clear();
    graphSelection.setLabelEdit(null);
  }

  function onReorder(toFront: boolean) {
    topologyStore.manager.reorderAnnotations(
      graphSelection.annotationIds,
      toFront,
    );
  }

  function onSelectMembers() {
    const group = groupsRef.current.find(
      group => group.id === menuTargetRef.current,
    );
    if (group) graphSelection.select({nodeIds: group.memberIds});
  }

  function onDeleteSelection() {
    const cy = cyRef.current;
    if (!cy || graphSelection.count === 0) return;

    const deletedGroups = groupsRef.current.filter(group =>
      graphSelection.groupIds.includes(group.id),
    );
    const nodeNames = [
      ...new Set([
        ...graphSelection.nodeIds,
        ...deletedGroups.flatMap(group => group.memberIds),
      ]),
    ];
    const annotationIds = [
      ...graphSelection.shapeIds,
      ...graphSelection.textIds,
    ];

    // The selection is cleared after the change, so the history keeps it for undo
    topologyStore.manager.deleteElements(
      nodeNames,
      [],
      deletedGroups.map(group => group.id),
      annotationIds,
    );
    graphSelection.clear();
  }

  function onGroupSelection() {
    const cy = cyRef.current;
    if (!cy) return;

    const nodes = selectedNodes(cy);
    const box = groupBoxAround(nodes.map(node => node.position()));
    if (!box) return;

    const memberLayouts = new Map<string, NodeLayout>(
      nodes.map(node => [
        node.id(),
        {position: node.position(), groupId: null},
      ]),
    );

    const name = `Group ${groupsRef.current.length + 1}`;
    const groupId = topologyStore.manager.addGroup(
      {
        name,
        position: {x: box.x, y: box.y},
        width: box.width,
        height: box.height,
      },
      memberLayouts,
    );
    if (groupId === null) return;

    graphSelection.select({groupIds: [groupId]});
    startGroupRename({id: groupId, name, annotation: null, ...box});
  }

  function onUngroup() {
    if (graphSelection.groupIds.length === 0) return;

    topologyStore.manager.removeGroups(graphSelection.groupIds);
    graphSelection.setGroups([]);
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

  function onTextStyle(update: Partial<FreeTextAnnotation>) {
    graphSelection.setTextPreviews(new Map());
    topologyStore.manager.updateLayout({
      texts: new Map(graphSelection.textIds.map(id => [id, update])),
    });
  }

  function onTextStylePreview(update: Partial<FreeTextAnnotation> | null) {
    graphSelection.setTextPreviews(
      new Map(update ? graphSelection.textIds.map(id => [id, update]) : []),
    );
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

  function onRenameSelection() {
    if (graphSelection.count !== 1) return;

    if (graphSelection.nodeIds.length === 1) {
      startNodeRename(graphSelection.nodeIds[0]);
      return;
    }

    const group = groupsRef.current.find(
      group => group.id === graphSelection.groupIds[0],
    );
    if (group) startGroupRename(group);
  }

  function startNodeRename(nodeId: string) {
    const node = cyRef.current?.getElementById(nodeId);
    if (!node?.nonempty()) return;

    graphSelection.setLabelEdit({
      kind: LabelKind.Node,
      id: nodeId,
      value: nodeId,
      position: boxCenter(
        node.boundingBox({
          includeNodes: false,
          includeLabels: true,
          includeOverlays: false,
          includeUnderlays: false,
        }),
      ),
    });
  }

  function startInterfaceRename(edgeId: string, endpointIndex: number) {
    const edge = cyRef.current?.getElementById(edgeId);
    if (!edge?.nonempty()) return;

    graphSelection.setLabelEdit({
      kind: LabelKind.Interface,
      id: edgeId,
      endpointIndex,
      value: edge.data(endpointIndex === 0 ? 'sourceLabel' : 'targetLabel'),
      position: boxCenter(
        edge.boundingBox({
          includeEdges: false,
          includeMainLabels: false,
          includeSourceLabels: endpointIndex === 0,
          includeTargetLabels: endpointIndex === 1,
          includeOverlays: false,
          includeUnderlays: false,
        }),
      ),
    });
  }

  // The field covers the label in the top left corner of the group
  function startGroupRename(group: Omit<GraphGroup, 'memberIds'>) {
    const inset = groupLabelInset(
      group,
      groupStyle(group.annotation).cornerRadius,
    );

    graphSelection.setLabelEdit({
      kind: LabelKind.Group,
      id: group.id,
      value: group.name,
      position: {x: group.x + 4 + inset, y: group.y + 2 + inset},
    });
  }

  /**
   * Saves the edited label. An invalid value shows an error while the field is
   * open, and keeps the label as it was once the field is left.
   */
  function onLabelSubmit(value: string, isImplicit: boolean) {
    const labelEdit = graphSelection.labelEdit;
    if (!labelEdit) return null;

    const name = value.trim();
    const error = validateLabel(labelEdit, name);
    if (error && !isImplicit) return error;

    graphSelection.setLabelEdit(null);
    if (error || name === labelEdit.value) return null;

    switch (labelEdit.kind) {
      case LabelKind.Group:
        topologyStore.manager.updateLayout({
          groups: new Map([[labelEdit.id, {name}]]),
        });
        break;
      case LabelKind.Node:
        topologyStore.manager.renameNode(labelEdit.id, name);
        break;
      case LabelKind.Interface: {
        const edge = cyRef.current?.getElementById(labelEdit.id);
        if (!edge?.nonempty()) break;

        topologyStore.manager.renameInterface(
          Number(labelEdit.id),
          labelEdit.endpointIndex!,
          edge.data(labelEdit.endpointIndex === 0 ? 'source' : 'target'),
          name,
        );
        break;
      }
    }

    return null;
  }

  function validateLabel(labelEdit: LabelEdit, name: string) {
    switch (labelEdit.kind) {
      case LabelKind.Group:
        return name === '' ? "The name can't be empty" : null;
      case LabelKind.Node:
        return validateNodeName(
          name,
          labelEdit.id,
          cyRef.current?.nodes('.topology-node').map(node => node.id()) ?? [],
        );
      case LabelKind.Interface: {
        const edge = cyRef.current?.getElementById(labelEdit.id);

        return validateInterfaceName(
          name,
          edge?.data(labelEdit.endpointIndex === 0 ? 'source' : 'target'),
          Number(labelEdit.id),
          props.openTopology?.connections ?? [],
        );
      }
    }
  }

  /**
   * Saves the box of a resized annotation once it is resized. Moveable shows the
   * box while it is resized, only the members of a group are moved meanwhile.
   * Without an annotation, the whole selection is resized.
   */
  function onResize(
    item: AnnotationItem | null,
    startBox: Box,
    box: Box,
    isFinal: boolean,
  ) {
    if (!item) {
      onResizeSelection(startBox, box, isFinal);
      return;
    }

    switch (item.kind) {
      case 'group':
        onResizeGroup(item.group, box, isFinal);
        break;
      case 'shape':
        if (!isFinal) break;

        topologyStore.manager.updateLayout({
          shapes: new Map([[item.id, boxFields(box)]]),
        });
        break;
      case 'text':
        if (!isFinal) break;

        topologyStore.manager.updateLayout({
          texts: new Map([[item.id, boxFields(box)]]),
        });
        break;
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

  // The elements of the selection keep their place relative to its box
  function onResizeSelection(startBox: Box, box: Box, isFinal: boolean) {
    const cy = cyRef.current;
    if (!cy) return;

    const starts = (selectionResizeStarts.current ??= selectionStarts(
      cy,
      null,
    ));
    const transform = scaleTransform(startBox, box);

    if (isFinal) {
      selectionResizeStarts.current = null;
      commitTransform(starts, transform);
      return;
    }

    transformNodes(starts, transform);
    transformPreviews(starts, transform);
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
    topologyStore.manager.clear();
    graphSelection.clear();
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

  const clipboardActions = {
    onCopy: onMenuCopy,
    onCut: onMenuCut,
    onDuplicate,
  };

  // The children don't render again with the editor, unless what they show changed
  const callbacks = useStableCallbacks({
    getCy: () => cyRef.current,
    onLabelSubmit,
    getLayerBoxes: () =>
      annotationBoxes(
        layerItemsRef.current,
        textsRef.current,
        graphSelection.textSizes,
      ),
    onGroupSelection,
    onStyle,
    onStylePreview,
    onResetStyle,
    onTextStyle,
    onTextStylePreview,
    onTextEditEnd,
    onBringToFront: () => onReorder(true),
    onSendToBack: () => onReorder(false),
    onUngroup,
    onDeleteSelection,
    onResize,
    getSelectionBox: () => selectionLayerRef.current?.frameBox() ?? null,
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
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <TopologyGraph
        ref={graphRef}
        elements={elements}
        fitKey={props.openTopology?.id ?? null}
        events={{
          'click node': onNodeClick,
          'click edge': onEdgeClick,
          tap: onTap,
          tapstart: onGraphPointerDown,
          'tapstart node': onNodePointerDown,
          dbltap: onGraphDoubleClick,
          'dbltap node': onNodeDoubleClick,
          'dbltap edge': onEdgeDoubleClick,
          cxttap: onGraphContext,
          'cxttap node': onNodeContext,
          'cxttap edge': onEdgeContext,
        }}
        onInstance={onInstance}
        getLayerBoxes={callbacks.getLayerBoxes}
        underlay={
          <>
            <AnnotationLayer items={layerItems} state={graphSelection} />
            <EdgeHalo getCy={callbacks.getCy} />
          </>
        }
        overlay={
          <>
            <TextLayer
              texts={texts}
              state={graphSelection}
              onEditEnd={callbacks.onTextEditEnd}
            />
            <SelectionLayer
              ref={selectionLayerRef}
              getCy={callbacks.getCy}
              items={annotationItems}
            />
            <LabelEditor onSubmit={callbacks.onLabelSubmit} />
            <LineHandles
              layerItems={layerItems}
              onPointerDown={callbacks.onLineEndPointerDown}
            />
            <SelectionOverlay
              getCy={callbacks.getCy}
              items={annotationItems}
              onGroup={callbacks.onGroupSelection}
              onStyle={callbacks.onStyle}
              onStylePreview={callbacks.onStylePreview}
              onResetStyle={callbacks.onResetStyle}
              onTextStyle={callbacks.onTextStyle}
              onTextStylePreview={callbacks.onTextStylePreview}
              onBringToFront={callbacks.onBringToFront}
              onSendToBack={callbacks.onSendToBack}
              onUngroup={callbacks.onUngroup}
              onDelete={callbacks.onDeleteSelection}
            />
          </>
        }
      />
      <MoveableHandles
        ref={moveableHandlesRef}
        getCy={callbacks.getCy}
        items={annotationItems}
        getSelectionBox={callbacks.getSelectionBox}
        onResize={callbacks.onResize}
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

function boxCenter(bounds: cytoscape.BoundingBox12): Position {
  return {x: (bounds.x1 + bounds.x2) / 2, y: (bounds.y1 + bounds.y2) / 2};
}

function drawHint(drawKind: DrawKind, geometry: ShapeGeometry): HintPart[] {
  if (drawKind === 'line') {
    return ['Hold ', {keyword: 'Shift'}, ' to draw horizontally or vertically'];
  }

  const box = shapeBox(geometry);
  const size = `${Math.round(box.width)} × ${Math.round(box.height)}`;

  return [
    `${size} · Hold `,
    {keyword: 'Shift'},
    ` for a ${drawKind === 'circle' ? 'circle' : 'square'}`,
  ];
}

// Selects only the given group, shape or text
function itemSelection(
  kind: AnnotationItem['kind'],
  id: string,
): Partial<GraphSelectionSnapshot> {
  return {
    groupIds: kind === 'group' ? [id] : [],
    shapeIds: kind === 'shape' ? [id] : [],
    textIds: kind === 'text' ? [id] : [],
  };
}

function boxUpdates(
  boxes: Map<string, Box>,
): Map<string, ReturnType<typeof boxFields>> {
  return new Map([...boxes].map(([id, box]) => [id, boxFields(box)]));
}

// The fields of an annotation that store its box
function boxFields(box: Box) {
  return {
    position: roundPosition(box),
    width: roundCoordinate(box.width),
    height: roundCoordinate(box.height),
  };
}

export default NodeEditor;
