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

import {MenuItem} from 'primereact/menuitem';

import SBContextMenu, {
  SBContextMenuRef,
} from '@sb/components/common/sb-context-menu/sb-context-menu';
import AnnotationLayer from '@sb/components/common/topology-graph/annotation-layer/annotation-layer';
import TextLayer from '@sb/components/common/topology-graph/text-layer/text-layer';
import TopologyGraph, {
  TopologyGraphRef,
} from '@sb/components/common/topology-graph/topology-graph';
import EdgeHalo from '@sb/components/editor-page/topology-editor/node-editor/edge-halo/edge-halo';
import {
  ArrangeOptions,
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
  boxCenter,
  boxesOverlap,
  containsBox,
  containsPoint,
  DrawKind,
  drawnShapeGeometry,
  fitIntoGroupBox,
  GraphGroup,
  GraphShape,
  groupAt,
  groupBoxAround,
  groupBoxAroundBoxes,
  groupContents,
  GroupHitPart,
  groupInnerBox,
  groupLabelInset,
  growBox,
  growGroupBox,
  hitTestLayers,
  LayerHit,
  layerHits,
  minGroupSize,
  moveBox,
  moveShapeGeometry,
  nodeBox,
  nodeShapeBox,
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
  Size,
  storedTextBox,
  textAt,
  textBox,
  transformShapeGeometry,
  translateTransform,
  unionBox,
} from '@sb/lib/graph/annotation-geometry';
import {
  AnnotationStyle,
  defaultStyle,
  fillColor,
  groupStyle,
  groupStyleReset,
  groupStyleUpdate,
  newShapeStyle,
  NO_COLOR,
  shapeStyle,
  shapeStyleUpdate,
  textStyle,
} from '@sb/lib/graph/annotation-style';
import {
  closestConnection,
  Connectable,
  CONNECTION_ARROW_OFFSET,
  CONNECTION_ARROW_RADIUS,
  CONNECTION_SIDES,
  connectionArrowAt,
  connectionPoint,
  followLines,
  LineAttachment,
  lineAttachments,
} from '@sb/lib/graph/connections';
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
import {
  SNAP_DISTANCE,
  SnapGuide,
  snapMove,
  snapPoint,
  SnapTargets,
  snapTargets,
} from '@sb/lib/graph/snapping';
import {
  findNodeAnnotation,
  groupParentUpdate,
} from '@sb/lib/graph/topology-annotations';
import {NodeLayout} from '@sb/lib/graph/topology-graph';
import {useDeviceStore, useTopologyStore} from '@sb/lib/stores/root-store';
import {GraphSelectionSnapshot} from '@sb/lib/topology-history';
import {useStableCallbacks} from '@sb/lib/utils/hooks';
import {If} from '@sb/types/control';
import {
  FreeShapeAnnotation,
  FreeTextAnnotation,
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

const NUDGE_DISTANCE = 5;
const NUDGE_MERGE_KEY = 'nudge';

// Distance on screen within which a line end connects to a connection point
const CONNECT_DISTANCE = 16;

// Distance in the graph within which a snapped line end lies on a connection point
const ON_POINT_DISTANCE = 0.05;

// Distance on screen around elements within which their connection points are shown
const CONNECTION_RANGE = 32;

// Factor by which the zoom buttons change the zoom
const ZOOM_STEP = 1.25;

// Moving the pointer by less than this many pixels counts as a click, like in cytoscape
const DRAG_THRESHOLD = 5;

// Distance in pixels at which lines and outlines of shapes are still hit
const HIT_TOLERANCE = 6;

// Shapes that are drawn smaller than this are placed with their default size
const MIN_SHAPE_SIZE = 4;

type ElementKind = 'node' | 'group' | 'shape' | 'text';

// An element of the graph that can be inside a group
interface ElementRef {
  kind: ElementKind;
  id: string;
}

const ELEMENT_LABELS: Record<ElementKind, string> = {
  node: 'node',
  group: 'group',
  shape: 'shape',
  text: 'text',
};

/**
 * The selected elements as they were when the selection started to move or to
 * be resized, including everything inside the selected groups.
 */
interface SelectionStarts {
  boxes: Map<string, Box>;
  shapes: Map<string, ShapeGeometry>;
  texts: Map<string, Pick<FreeTextAnnotation, 'position' | 'width' | 'height'>>;
  memberPositions: Map<string, Position>;

  // The moved elements that aren't inside a moved group, they can join, leave and grow groups
  freeElements: ElementRef[];

  // The ends of the other lines that lie on connection points, they follow their elements
  attachments: LineAttachment[];
}

/**
 * The contents of a group as they were when it started to be resized. Each
 * direct member is moved into the group on its own, with everything inside it.
 */
interface GroupResizeStarts {
  // The boxes of the direct members by element key
  memberBoxes: Map<string, Box>;
  contents: SelectionStarts;

  // The direct member each element moves with, by element key
  owners: Map<string, string>;
}

// An element that is dropped, with its box and center after it moved
interface DroppedElement {
  element: ElementRef;
  box: Box;
  center: Position;
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

      // The topmost element at the press, and whether the press kept the selection instead of selecting it
      pressed: ElementRef;
      keptSelection: boolean;
      isShift: boolean;

      /*
       * The box around the moved elements and what it snaps to, collected when
       * they first move, null if they have no box
       */
      snapping?: {box: Box; targets: SnapTargets} | null;
      snapOffset: Position;
      snapGuides: SnapGuide[];
    } & SelectionStarts)
  | {
      kind: 'draw';
      drawKind: DrawKind;
      origin: Position;
      originClient: Position;
      hasMoved: boolean;

      // What the corners of the drawn shape snap to, and what the ends of a drawn line connect to
      snapping: SnapTargets;
      connectables: Connectable[] | null;

      // The element whose arrow the line is drawn from, a click selects it instead
      pressed?: ElementRef;
    }
  | {
      kind: 'move-line-end';
      shapeId: string;
      end: LineEnd;
      geometry: ShapeGeometry;
      hasMoved: boolean;

      // What the dragged end snaps and connects to
      snapping: SnapTargets;
      connectables: Connectable[];
    }
  | {kind: 'pan'; lastClient: Position};

type MoveLayersAction = Extract<PointerAction, {kind: 'move-layers'}>;

/**
 * Where the moved elements end up when they are dropped. An element joins the
 * group it is dropped on, and a member stays in its group, which grows to
 * contain it. With ctrl, elements end up outside of all groups.
 */
interface DropPlan {
  // The group of each dropped element by its element key
  groupIds: Map<string, string | null>;
  groupBoxes: Map<string, Box>;
  hint: HintPart[] | null;
  dropTargetId: string | null;
}

const NodeEditor = observer((props: NodeEditorProps) => {
  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[] | null>(
    null,
  );

  const deviceStore = useDeviceStore();
  const topologyStore = useTopologyStore();
  const isReadOnly =
    !!props.openTopology && !topologyStore.canEdit(props.openTopology);
  const simulationConfig = useSimulationConfig();
  const graphSelection = useGraphSelection();

  const graphRef = useRef<TopologyGraphRef>(null);
  const moveableHandlesRef = useRef<MoveableHandlesRef>(null);
  const selectionLayerRef = useRef<SelectionLayerRef>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const nodeConnectionSource = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<SBContextMenuRef | null>(null);

  // The event that opens the context menu once it shows its new items
  const pendingMenuEvent = useRef<MouseEvent | null>(null);
  const menuTargetRef = useRef<string | null>(null);
  // Position in the graph where the context menu of the graph was opened
  const contextMenuPosition = useRef<Position>({x: 0, y: 0});
  const pointerAction = useRef<PointerAction | null>(null);

  // The element last selected by clicking through, the next click on it goes further down
  const clickedThrough = useRef<string | null>(null);

  const isDragCtrl = useRef(false);
  const moveFrame = useRef(0);

  // The contents of a resized group from before it was resized
  const groupResizeStarts = useRef<GroupResizeStarts | null>(null);
  const selectionResizeStarts = useRef<SelectionStarts | null>(null);

  // The element whose connection arrows are shown, they stay while the pointer moves to them
  const hoveredConnectableKey = useRef<string | null>(null);

  // The lines attached to elements when a shape or text started to be resized
  const resizeAttachments = useRef<LineAttachment[] | null>(null);

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

      // Any press but one on a node stops drawing a link, the middle button still pans
      if (
        nodeConnectionSource.current &&
        event.button !== 1 &&
        !isNodePress(event)
      ) {
        exitConnectionMode();
      }
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

  /*
   * The menu takes its items over in an effect, so it is shown after they
   * changed. Otherwise it measures the previous items to keep itself on screen.
   */
  useEffect(() => {
    const event = pendingMenuEvent.current;
    if (!event) return;

    pendingMenuEvent.current = null;
    contextMenuRef.current?.show(event);
  }, [contextMenuModel]);

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

  function onNodeConnectStart() {
    const cy = cyRef.current;
    if (!cy || menuTargetRef.current === null) return;

    nodeConnectionSource.current = menuTargetRef.current;

    // Nothing is selected while a link is drawn, so it can't be deleted meanwhile
    graphSelection.clear();
  }

  function onNodeEdit() {
    if (!cyRef.current || menuTargetRef.current === null) return;

    props.onEditNode(menuTargetRef.current);
  }

  function onKeyDown(event: KeyboardEvent) {
    onDragCtrlChange(event);
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
    onDragCtrlChange(event);
    if (event.key === ' ') graphSelection.setHandHeld(false);
  }

  /*
   * Ctrl changes where dragged elements are dropped and alt turns snapping off,
   * so they apply without moving the pointer.
   */
  function onDragCtrlChange(event: KeyboardEvent) {
    const action = pointerAction.current;
    if (
      !['Control', 'Meta', 'Alt'].includes(event.key) ||
      action?.kind !== 'move-layers' ||
      !action.hasMoved
    ) {
      return;
    }

    // Alt would focus the menu bar of the browser
    if (event.key === 'Alt') event.preventDefault();

    isDragCtrl.current = event.ctrlKey || event.metaKey;
    snapMovedSelection(action, event.altKey);
    transformNodes(action, moveTransform(action));
    transformPreviews(action, moveTransform(action), action.pointer);
    graphSelection.setSnapGuides(action.snapGuides);
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
      case GraphAction.BringForward:
        onStep(true);
        break;
      case GraphAction.BringBackward:
        onStep(false);
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

    graphSelection.setConnectionLine({
      sourceId: nodeConnectionSource.current,
      pointer: toGraphPosition(cyRef.current, event.clientX, event.clientY),
    });
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

      const action = startDraw(drawKind, position, event);
      action.origin = drawCorner(action, position, event).position;
      return;
    }

    /*
     * A press on an arrow of the hovered element draws a line from it, a press
     * on the end of a line connected to it moves that end.
     */
    const hovered =
      event.button === 0 &&
      !event.altKey &&
      graphSelection.tool === GraphTool.Select
        ? hoveredConnectable(position, connectables())
        : null;
    const press = hovered && connectionPressAt(hovered, position);

    if (press?.kind === 'move-end') {
      event.stopPropagation();
      graphSelection.select(itemSelection('shape', press.attachment.lineId));
      onLineEndPointerDown(
        press.attachment.lineId,
        press.attachment.end,
        event,
      );
      return;
    }

    if (hovered && press?.kind === 'draw') {
      event.preventDefault();
      event.stopPropagation();

      const [kind, id] = splitElementKey(hovered.key);
      startDraw('line', press.origin, event, {kind, id});
      return;
    }

    const text = textAt(textsRef.current, graphSelection.textSizes, position);
    if (!text) return;

    event.stopPropagation();
    pressedTextId.current = text.id;
    if (event.button !== 0) return;

    event.preventDefault();

    if ((event.ctrlKey || event.metaKey) && openLinkAt(text.id, event)) return;

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
    if (!text) return;

    graphSelection.select({textIds: [text.id]});
    graphSelection.setEditingText(text.id);
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
      graphSelection.isHandActive
    ) {
      return;
    }

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
   * the selection. A press that keeps the selection moves it instead.
   */
  function onAnnotationPointerDown(
    item: AnnotationItem,
    position: Position,
    originClient: Position,
    isShift: boolean,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    const keptSelection = keepsSelection(position);

    if (isShift) {
      if (item.kind === 'group') graphSelection.toggleGroup(item.id);
      if (item.kind === 'shape') graphSelection.toggleShape(item.id);
      if (item.kind === 'text') graphSelection.toggleText(item.id);
    } else if (!keptSelection) {
      clickedThrough.current = null;
      graphSelection.select(itemSelection(item.kind, item.id));
    }

    startMove(
      position,
      originClient,
      {kind: item.kind, id: item.id},
      keptSelection,
      isShift,
    );
  }

  /**
   * Whether a press keeps the selection, so it is moved when dragged. It does if
   * the topmost element at the press is selected, or if the selected element
   * there was reached by clicking through. Otherwise the press selects the
   * topmost element.
   */
  function keepsSelection(position: Position): boolean {
    const elements = elementsAt(position);
    const index = elements.findIndex(isSelected);

    return (
      index === 0 ||
      (index > 0 && clickedThrough.current === elementKey(elements[index]))
    );
  }

  /**
   * Starts moving the selection. A node pressed with shift moves with it, even
   * if it isn't selected yet.
   */
  function startMove(
    position: Position,
    originClient: Position,
    pressed: ElementRef,
    keptSelection: boolean,
    isShift: boolean,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    pointerAction.current = {
      kind: 'move-layers',
      origin: position,
      originClient,
      pointer: position,
      hasMoved: false,
      pressed,
      keptSelection,
      isShift,
      snapOffset: {x: 0, y: 0},
      snapGuides: [],
      ...selectionStarts(
        cy,
        pressed.kind === 'node' && isShift ? pressed.id : null,
      ),
    };
  }

  /**
   * Returns the elements at the given position from the topmost one down: texts
   * above the graph, then nodes, then groups and shapes below the graph.
   */
  function elementsAt(position: Position): ElementRef[] {
    const cy = cyRef.current;
    if (!cy) return [];

    const texts = textsRef.current
      .filter(text => {
        const box = textBox(
          text.annotation,
          graphSelection.textSizes.get(text.id),
        );
        return box !== null && containsPoint(box, position);
      })
      .map(text => ({kind: 'text' as const, id: text.id}));
    const nodes = cy
      .nodes('.topology-node')
      .filter(node =>
        containsPoint(
          boundsToBox(
            node.boundingBox({includeOverlays: false, includeUnderlays: false}),
          ),
          position,
        ),
      )
      .map(node => ({kind: 'node' as const, id: node.id()}));
    const layers = [
      ...layerHits(layerItemsRef.current, position, HIT_TOLERANCE / cy.zoom()),
    ].map(hit => ({
      kind: hit.kind,
      id: hit.kind === 'group' ? hit.group.id : hit.shape.id,
    }));

    return [...texts.toReversed(), ...nodes.toReversed(), ...layers];
  }

  function isSelected(element: ElementRef): boolean {
    switch (element.kind) {
      case 'node':
        return graphSelection.nodeIds.includes(element.id);
      case 'group':
        return graphSelection.groupIds.includes(element.id);
      case 'shape':
        return graphSelection.shapeIds.includes(element.id);
      case 'text':
        return graphSelection.textIds.includes(element.id);
    }
  }

  /**
   * A click without moving on the selected element selects the element below it
   * at that spot, after the bottom one it starts at the top again. A click on a
   * selection of several elements selects only the clicked one, shift adds or
   * removes a node.
   */
  function onSelectionClick(action: MoveLayersAction) {
    if (action.isShift) {
      if (action.pressed.kind === 'node') {
        graphSelection.toggleNode(action.pressed.id);
      }
      return;
    }

    // The press already selected the clicked element
    if (!action.keptSelection) return;

    const elements = elementsAt(action.origin);
    const index =
      graphSelection.count === 1 ? elements.findIndex(isSelected) : -1;
    const isClickingThrough =
      index === 0 ||
      (index > 0 && clickedThrough.current === elementKey(elements[index]));

    if (isClickingThrough) {
      const below = elements[(index + 1) % elements.length];
      clickedThrough.current = elementKey(below);
      graphSelection.select(itemSelection(below.kind, below.id));
      return;
    }

    clickedThrough.current = null;
    graphSelection.select(
      itemSelection(action.pressed.kind, action.pressed.id),
    );
  }

  function selectionStarts(
    cy: cytoscape.Core,
    pressedNodeId: string | null,
  ): SelectionStarts {
    const starts: SelectionStarts = {
      boxes: new Map(),
      shapes: new Map(),
      texts: new Map(),
      memberPositions: new Map(),
      freeElements: [],
      attachments: [],
    };

    // Everything inside the selected groups moves with them
    const inside = new Set(
      graphSelection.groupIds
        .flatMap(groupId => contentElements(groupId))
        .map(elementKey),
    );

    const selected: ElementRef[] = [
      ...[
        ...new Set([
          ...graphSelection.nodeIds,
          ...(pressedNodeId ? [pressedNodeId] : []),
        ]),
      ].map(id => ({kind: 'node' as const, id})),
      ...graphSelection.groupIds.map(id => ({kind: 'group' as const, id})),
      ...graphSelection.shapeIds.map(id => ({kind: 'shape' as const, id})),
      ...graphSelection.textIds.map(id => ({kind: 'text' as const, id})),
    ];
    starts.freeElements = selected.filter(
      element => !inside.has(elementKey(element)),
    );

    for (const key of new Set([...inside, ...selected.map(elementKey)])) {
      const [kind, id] = splitElementKey(key);
      addStart(starts, {kind, id}, cy);
    }

    // The moved lines move as a whole
    starts.attachments = currentAttachments(new Set(starts.shapes.keys()));

    return starts;
  }

  // Everything inside a group, including the contents of nested groups
  function contentElements(groupId: string): ElementRef[] {
    const contents = groupContents(groupsRef.current, groupId);

    return [
      ...contents.nodeIds.map(id => ({kind: 'node' as const, id})),
      ...contents.groupIds.map(id => ({kind: 'group' as const, id})),
      ...contents.shapeIds.map(id => ({kind: 'shape' as const, id})),
      ...contents.textIds.map(id => ({kind: 'text' as const, id})),
    ];
  }

  // Adds the current geometry of the element to the starts
  function addStart(
    starts: SelectionStarts,
    element: ElementRef,
    cy: cytoscape.Core,
  ) {
    switch (element.kind) {
      case 'node':
        starts.memberPositions.set(element.id, {
          ...cy.getElementById(element.id).position(),
        });
        break;
      case 'group': {
        const group = groupsRef.current.find(group => group.id === element.id);
        if (group) starts.boxes.set(element.id, boxOf(group));
        break;
      }
      case 'shape': {
        const item = findLayerItem(element.id);
        if (item?.kind === 'shape') {
          starts.shapes.set(element.id, shapeGeometry(item.shape.annotation));
        }
        break;
      }
      case 'text': {
        const text = textsRef.current.find(text => text.id === element.id);
        if (text) {
          starts.texts.set(element.id, {
            position: text.annotation.position,
            width: text.annotation.width,
            height: text.annotation.height,
          });
        }
        break;
      }
    }
  }

  function onLineEndPointerDown(
    shapeId: string,
    end: LineEnd,
    event: MouseEvent,
  ) {
    const item = findLayerItem(shapeId);
    if (item?.kind !== 'shape') return;

    event.preventDefault();

    pointerAction.current = {
      kind: 'move-line-end',
      shapeId,
      end,
      geometry: shapeGeometry(item.shape.annotation),
      hasMoved: false,
      snapping: snapTargetsWithout(new Set()),
      connectables: connectables(),
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
    lastPointer.current = {x: event.clientX, y: event.clientY};

    // While something is dragged, only a drawn line or a dragged line end shows connection points, nothing shows arrows
    if (cy && !action && !graphSelection.isInteracting) {
      showHoveredConnections(cy, event);
    } else {
      graphSelection.setConnectionArrows(null);
      if (action?.kind !== 'draw' && action?.kind !== 'move-line-end') {
        graphSelection.setConnectionPoints(null);
      }
    }
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

      const end = lineEndAt(
        action.connectables,
        action.snapping,
        position,
        event,
      );
      graphSelection.setSnapGuides(end.guides);
      graphSelection.setShapePreviews(
        new Map([
          [
            action.shapeId,
            movedLineEnd(
              action,
              end.position,
              event.shiftKey && !end.isConnected,
            ),
          ],
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
      const corner = drawCorner(action, position, event);
      const geometry = drawnShapeGeometry(
        action.drawKind,
        action.origin,
        corner.position,
        event.shiftKey && !corner.isConnected,
      );
      graphSelection.setSnapGuides(corner.guides);

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
    snapMovedSelection(action, event.altKey);
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
        transformPreviews(action, moveTransform(action), action.pointer);
        graphSelection.setSnapGuides(action.snapGuides);
      }
    });
  }

  function moveTransform(action: MoveLayersAction) {
    return translateTransform({
      x: action.pointer.x - action.origin.x + action.snapOffset.x,
      y: action.pointer.y - action.origin.y + action.snapOffset.y,
    });
  }

  /**
   * Snaps the moved elements to the edges and centers of the other elements, to
   * equal gaps between the elements of their group and to the grid, unless alt
   * is held.
   */
  function snapMovedSelection(action: MoveLayersAction, isAlt: boolean) {
    const cy = cyRef.current;
    if (!cy) return;

    if (action.snapping === undefined) {
      const boxes = action.freeElements.map(snapBox);
      const box = unionBox(boxes.filter(box => box !== null));

      // The elements keep equal gaps to the other elements of their group
      const parentIds = currentParentIds();
      const groupIds = new Set(
        action.freeElements.map(
          element => parentIds.get(elementKey(element)) ?? null,
        ),
      );

      action.snapping = box
        ? {
            box,
            targets: snapTargetsWithout(
              movedElementKeys(action),
              groupIds.size === 1 ? [...groupIds][0] : undefined,
            ),
          }
        : null;
    }

    if (!action.snapping || isAlt) {
      action.snapOffset = {x: 0, y: 0};
      action.snapGuides = [];
      return;
    }

    // Nodes alone are centered on the grid
    const {offset, guides} = snapMove(
      moveBox(action.snapping.box, {
        x: action.pointer.x - action.origin.x,
        y: action.pointer.y - action.origin.y,
      }),
      action.snapping.targets,
      SNAP_DISTANCE / cy.zoom(),
      action.freeElements.every(element => element.kind === 'node')
        ? 'center'
        : 'start',
    );
    action.snapOffset = offset;
    action.snapGuides = guides;
  }

  /*
   * Starts drawing a shape from the given origin. A line drawn from an arrow of
   * the pressed element selects the element on a click instead.
   */
  function startDraw(
    drawKind: DrawKind,
    origin: Position,
    event: MouseEvent,
    pressed?: ElementRef,
  ): Extract<PointerAction, {kind: 'draw'}> {
    const action: Extract<PointerAction, {kind: 'draw'}> = {
      kind: 'draw',
      drawKind,
      origin,
      originClient: {x: event.clientX, y: event.clientY},
      hasMoved: false,
      snapping: snapTargetsWithout(new Set()),
      connectables: drawKind === 'line' ? connectables() : null,
      pressed,
    };
    pointerAction.current = action;
    return action;
  }

  /*
   * The corner of the drawn shape at the pointer. The ends of a line connect to
   * connection points, the other corners only snap, unless alt is held. They
   * don't snap while shift keeps the ratio of the shape or the angle of a line.
   */
  function drawCorner(
    action: Extract<PointerAction, {kind: 'draw'}>,
    position: Position,
    event: Pick<MouseEvent, 'altKey' | 'shiftKey'>,
  ): {position: Position; guides: SnapGuide[]; isConnected: boolean} {
    const cy = cyRef.current;
    if (action.connectables) {
      return lineEndAt(action.connectables, action.snapping, position, event);
    }
    if (!cy || event.altKey || event.shiftKey) {
      return {position, guides: [], isConnected: false};
    }

    return {
      ...snapPoint(position, action.snapping, SNAP_DISTANCE / cy.zoom()),
      isConnected: false,
    };
  }

  /*
   * Where a line end at the pointer goes: onto the closest connection point of
   * the elements near it, or else it snaps like the corners of other shapes,
   * unless alt is held. The connection points of those elements are shown.
   */
  function lineEndAt(
    connectables: Connectable[],
    targets: SnapTargets,
    position: Position,
    event: Pick<MouseEvent, 'altKey' | 'shiftKey'>,
  ): {position: Position; guides: SnapGuide[]; isConnected: boolean} {
    const cy = cyRef.current;
    if (!cy || event.altKey) {
      graphSelection.setConnectionPoints(null);
      return {position, guides: [], isConnected: false};
    }

    const near = connectablesNear(connectables, position);
    const snapped = event.shiftKey
      ? {position, guides: []}
      : snapPoint(position, targets, SNAP_DISTANCE / cy.zoom());

    // An end that snaps onto a connection point connects to it as well, without guides
    const connection =
      closestConnection(position, near, CONNECT_DISTANCE / cy.zoom()) ??
      closestConnection(snapped.position, near, ON_POINT_DISTANCE);

    graphSelection.setConnectionPoints(
      near.length > 0
        ? {
            points: near.flatMap(element =>
              CONNECTION_SIDES.map(side => ({
                position: connectionPoint(element.box, side),
                fill: element.fill,
                stroke: element.stroke,
              })),
            ),
            active: connection?.position ?? null,
          }
        : null,
    );

    return connection
      ? {position: connection.position, guides: [], isConnected: true}
      : {...snapped, isConnected: false};
  }

  /*
   * The element under the pointer shows its arrows with the select tool, a line
   * is drawn from the side of an arrow when it's pressed. Connection points are
   * only shown while a line is drawn or its end is dragged.
   */
  function showHoveredConnections(
    cy: cytoscape.Core,
    event: globalThis.MouseEvent,
  ) {
    const position = toGraphPosition(cy, event.clientX, event.clientY);
    const hovered =
      cy.container()?.contains(event.target as Node) &&
      graphSelection.tool === GraphTool.Select &&
      !graphSelection.isHandActive
        ? hoveredConnectable(position, connectables())
        : null;

    hoveredConnectableKey.current = hovered?.key ?? null;
    graphSelection.setConnectionPoints(null);
    graphSelection.setConnectionArrows(
      hovered
        ? {
            box: hovered.box,
            active: connectionArrowAt(hovered.box, position, cy.zoom()),
          }
        : null,
    );
  }

  /*
   * The element under the pointer that shows its connection arrows with the
   * select tool. It stays hovered while the pointer is on its way to its
   * arrows, and an element with a connection point right next to the pointer
   * counts as well, as the line ends connected there stick out of it.
   */
  function hoveredConnectable(
    position: Position,
    elements: Connectable[],
  ): Connectable | null {
    const cy = cyRef.current;
    if (!cy || elements.length === 0) return null;

    const topmost = elementsAt(position)[0];
    const hovered =
      topmost && elements.find(element => element.key === elementKey(topmost));
    if (hovered) return hovered;

    const previous = elements.find(
      element => element.key === hoveredConnectableKey.current,
    );
    const reach =
      (CONNECTION_ARROW_OFFSET + CONNECTION_ARROW_RADIUS) / cy.zoom();
    if (previous && containsPoint(growBox(previous.box, reach), position)) {
      return previous;
    }

    const closest = closestConnection(
      position,
      elements.filter(canGrabLineEnds),
      CONNECT_DISTANCE / cy.zoom(),
    );
    return closest
      ? (elements.find(element => element.key === closest.key) ?? null)
      : null;
  }

  /*
   * What a press on the hovered element at the position starts: drawing a line
   * from the side of the arrow there, or moving the end of the topmost line
   * connected at the connection point there.
   */
  function connectionPressAt(
    element: Connectable,
    position: Position,
  ):
    | {kind: 'draw'; origin: Position}
    | {kind: 'move-end'; attachment: LineAttachment}
    | null {
    const zoom = cyRef.current?.zoom() ?? 1;
    const side = connectionArrowAt(element.box, position, zoom);
    if (side) return {kind: 'draw', origin: connectionPoint(element.box, side)};

    const point = canGrabLineEnds(element)
      ? closestConnection(position, [element], CONNECT_DISTANCE / zoom)
      : null;
    const attachment = point
      ? currentAttachments(new Set())
          .filter(
            attachment =>
              attachment.key === element.key && attachment.side === point.side,
          )
          .at(-1)
      : undefined;

    return attachment ? {kind: 'move-end', attachment} : null;
  }

  // The line ends on the element resized with handles can't be grabbed, its handles are on them
  function canGrabLineEnds(element: Connectable): boolean {
    return splitElementKey(element.key)[1] !== graphSelection.transformTargetId;
  }

  function connectablesNear(
    connectables: Connectable[],
    position: Position,
  ): Connectable[] {
    const range = CONNECTION_RANGE / (cyRef.current?.zoom() ?? 1);
    return connectables.filter(element =>
      containsPoint(growBox(element.box, range), position),
    );
  }

  // The groups, shapes and texts that lines connect to
  function connectables(): Connectable[] {
    return allElements()
      .filter(element => element.kind !== 'node' && !isLineElement(element))
      .flatMap(element => {
        const box = elementBox(element);
        return box
          ? [{key: elementKey(element), box, ...connectionColors(element)}]
          : [];
      });
  }

  // The fill and border of an element, a text has its background and its font color
  function connectionColors(element: ElementRef): {
    fill: string;
    stroke: string;
  } {
    const visible = (color: string, opacity = 100) =>
      color === NO_COLOR ? 'transparent' : fillColor(color, opacity);
    const colors = (style: AnnotationStyle) => ({
      fill: visible(style.fillColor, style.fillOpacity),
      stroke:
        style.borderColor === NO_COLOR ? 'var(--accent)' : style.borderColor,
    });

    switch (element.kind) {
      case 'group': {
        const group = groupsRef.current.find(group => group.id === element.id);
        if (group) return colors(groupStyle(group.annotation));
        break;
      }
      case 'shape': {
        const item = findLayerItem(element.id);
        if (item?.kind === 'shape') {
          return colors(shapeStyle(item.shape.annotation));
        }
        break;
      }
      case 'text': {
        const text = textsRef.current.find(text => text.id === element.id);
        if (!text) break;

        const style = textStyle(text.annotation);
        return {fill: visible(style.backgroundColor), stroke: style.fontColor};
      }
    }

    return {fill: 'transparent', stroke: 'var(--accent)'};
  }

  // The ends of the lines that lie on connection points, except of the given lines
  function currentAttachments(excludedLineIds: Set<string>): LineAttachment[] {
    const lines = layerItemsRef.current.flatMap(item =>
      item.kind === 'shape' &&
      item.shape.annotation.shapeType === 'line' &&
      !excludedLineIds.has(item.id)
        ? [{id: item.id, geometry: shapeGeometry(item.shape.annotation)}]
        : [],
    );

    return lines.length > 0 ? lineAttachments(lines, connectables()) : [];
  }

  /*
   * The lines attached to the moved or resized elements, with their ends on the
   * elements' new boxes. The contents of the starts move with the transform of
   * each element, the groups get the given boxes, which also contain the groups
   * that grow around dropped elements.
   */
  function followedLines(
    starts: SelectionStarts,
    transformOf: (kind: ElementKind, id: string) => SelectionTransform,
    groupBoxes: Map<string, Box>,
  ): Map<string, ShapeGeometry> {
    return followLines(starts.attachments, attachment => {
      const [kind, id] = splitElementKey(attachment.key);
      if (kind === 'group') return groupBoxes.get(id);

      const isMoved =
        (kind === 'shape' && starts.shapes.has(id)) ||
        (kind === 'text' && starts.texts.has(id));
      return isMoved ? transformOf(kind, id).box(attachment.box) : undefined;
    });
  }

  // The keys of all elements that move or are resized with the selection
  function movedElementKeys(starts: SelectionStarts): Set<string> {
    return new Set([
      ...[...starts.memberPositions.keys()].map(id =>
        elementKey({kind: 'node', id}),
      ),
      ...[...starts.boxes.keys()].map(id => elementKey({kind: 'group', id})),
      ...[...starts.shapes.keys()].map(id => elementKey({kind: 'shape', id})),
      ...[...starts.texts.keys()].map(id => elementKey({kind: 'text', id})),
    ]);
  }

  /*
   * The edges and centers of the elements in view except the given ones. Lines
   * don't count, their boxes aren't visible. The elements in the given group
   * are spaced, undefined if nothing is.
   */
  function snapTargetsWithout(
    excludedKeys: Set<string>,
    spacedGroupId?: string | null,
  ): SnapTargets {
    const view = boundsToBox(cyRef.current!.extent());
    const parentIds = spacedGroupId !== undefined ? currentParentIds() : null;

    const targets = allElements()
      .filter(
        element =>
          !excludedKeys.has(elementKey(element)) && !isLineElement(element),
      )
      .map(element => ({element, box: snapBox(element)}))
      .filter(
        (target): target is {element: ElementRef; box: Box} =>
          target.box !== null && boxesOverlap(target.box, view),
      );

    return snapTargets(
      targets.map(target => target.box),
      parentIds
        ? targets
            .filter(
              target =>
                (parentIds.get(elementKey(target.element)) ?? null) ===
                spacedGroupId,
            )
            .map(target => target.box)
        : [],
    );
  }

  // The box an element snaps by, nodes snap by the visible shape of their icon
  function snapBox(element: ElementRef): Box | null {
    if (element.kind !== 'node') return elementBox(element);

    const node = cyRef.current?.getElementById(element.id);
    return node?.nonempty()
      ? nodeShapeBox(node.position(), node.data('shape'))
      : null;
  }

  function isLineElement(element: ElementRef): boolean {
    if (element.kind !== 'shape') return false;

    const item = findLayerItem(element.id);
    return item?.kind === 'shape' && item.shape.annotation.shapeType === 'line';
  }

  // What a resized annotation or selection snaps to
  function resizeSnapTargets(item: AnnotationItem | null): SnapTargets | null {
    const cy = cyRef.current;
    if (!cy) return null;

    if (item) {
      return snapTargetsWithout(
        new Set(
          [
            {kind: item.kind, id: item.id},
            ...(item.kind === 'group' ? contentElements(item.id) : []),
          ].map(elementKey),
        ),
      );
    }

    return snapTargetsWithout(movedElementKeys(selectionStarts(cy, null)));
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
    pointer: Position | null,
  ) {
    const plan = planSelectionDrop(starts, transform, pointer, false);
    const groupBoxes = new Map([
      ...transformedGroupBoxes(starts, transform),
      ...plan.groupBoxes,
    ]);

    graphSelection.setDrag(plan.hint, plan.dropTargetId, groupBoxes);
    graphSelection.setShapePreviews(
      new Map([
        ...[...starts.shapes].map(
          ([id, geometry]) =>
            [id, transformShapeGeometry(geometry, transform)] as const,
        ),
        ...followedLines(starts, () => transform, groupBoxes),
      ]),
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
   * Saves the moved or resized selection. Everything inside moved groups stays
   * in them, the other elements are dropped into the group under them.
   */
  function commitTransform(
    starts: SelectionStarts,
    transform: SelectionTransform,
    pointer: Position | null,
    mergeKey?: string,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    transformNodes(starts, transform);

    const plan = planSelectionDrop(starts, transform, pointer, true);
    isDragCtrl.current = false;

    // The group of an element that was dropped, undefined if it moved with its group
    const droppedGroupId = (kind: ElementKind, id: string) =>
      plan.groupIds.get(elementKey({kind, id}));

    const memberGroupIds = currentGroupIds();
    const nodeLayouts = new Map<string, NodeLayout>();
    for (const nodeId of starts.memberPositions.keys()) {
      const groupId = droppedGroupId('node', nodeId);

      nodeLayouts.set(nodeId, {
        position: cy.getElementById(nodeId).position(),
        groupId:
          groupId !== undefined
            ? groupId
            : (memberGroupIds.get(nodeId) ?? null),
      });
    }

    const transformedBoxes = transformedGroupBoxes(starts, transform);
    const groupUpdates = new Map<string, Partial<GroupStyleAnnotation>>(
      boxUpdates(plan.groupBoxes),
    );
    for (const [id, box] of transformedBoxes) {
      const groupId = droppedGroupId('group', id);

      groupUpdates.set(id, {
        ...boxFields(box),
        ...(groupId !== undefined ? groupParentUpdate(groupId) : {}),
      });
    }

    const membership = (kind: ElementKind, id: string) => {
      const groupId = droppedGroupId(kind, id);
      return groupId !== undefined ? {groupId: groupId ?? undefined} : {};
    };

    graphSelection.clearDrag();
    topologyStore.manager.updateLayout(
      {
        nodes: nodeLayouts,
        groups: groupUpdates,
        shapes: new Map<string, Partial<FreeShapeAnnotation>>([
          ...[...starts.shapes].map(
            ([id, geometry]) =>
              [
                id,
                {
                  ...transformShapeGeometry(geometry, transform),
                  ...membership('shape', id),
                },
              ] as const,
          ),
          ...followedLines(
            starts,
            () => transform,
            new Map([...transformedBoxes, ...plan.groupBoxes]),
          ),
        ]),
        texts: new Map(
          [...starts.texts].map(([id, start]) => [
            id,
            {...transformText(start, transform), ...membership('text', id)},
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
    if (!cy || !action) return;

    if (action.kind === 'pan') {
      graphSelection.setHandHeld(false);
      return;
    }

    cy.userPanningEnabled(true);
    graphSelection.setInteracting(false);
    graphSelection.setMoving(false);

    if (action.kind === 'draw') {
      if (action.pressed && !action.hasMoved) {
        graphSelection.clearDrag();
        graphSelection.select(
          itemSelection(action.pressed.kind, action.pressed.id),
        );
        return;
      }

      const position = toGraphPosition(cy, event.clientX, event.clientY);
      const corner = drawCorner(action, position, event);
      commitDraw(
        action,
        corner.position,
        event.shiftKey && !corner.isConnected,
      );
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

    if (!action.hasMoved) {
      onSelectionClick(action);
      return;
    }

    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    action.pointer = toGraphPosition(cy, event.clientX, event.clientY);
    snapMovedSelection(action, event.altKey);
    commitTransform(action, moveTransform(action), action.pointer);
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
      const drawnBox = shapeBox(geometry);

      // Elements next to the group whose center it covers move into it
      const parentId =
        groupAt(groupsRef.current, boxCenter(drawnBox))?.id ?? null;
      const parentIds = currentParentIds();
      const members = allElements().filter(element => {
        const box = elementBox(element);

        return (
          box !== null &&
          (parentIds.get(elementKey(element)) ?? null) === parentId &&
          containsPoint(drawnBox, elementCenter(element, box))
        );
      });

      createGroup(
        growGroupBox(
          drawnBox,
          members.map(elementBox).filter(box => box !== null),
        ),
        members,
        parentId,
      );
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

  function onNodeClick(event: cytoscape.EventObject) {
    const nodeId = event.target.id();

    if (nodeConnectionSource.current && nodeConnectionSource !== nodeId) {
      topologyStore.manager.connectNodes(nodeConnectionSource.current, nodeId);
      exitConnectionMode();
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
   * away is selected while it moves. Shift adds or removes the node once it is
   * released without moving, like other clicks.
   */
  function onNodePointerDown(event: EventObject) {
    const cy = cyRef.current;
    const node = event.target as NodeSingular;
    const mouseEvent = event.originalEvent as unknown as globalThis.MouseEvent;
    if (
      !cy ||
      mouseEvent?.button !== 0 ||
      graphSelection.isHandActive ||
      !node.hasClass('topology-node') ||
      nodeConnectionSource.current
    ) {
      return;
    }

    const keptSelection = keepsSelection(event.position);
    if (!mouseEvent.shiftKey && !keptSelection) {
      clickedThrough.current = null;
      graphSelection.select({nodeIds: [node.id()]});
    }

    cy.userPanningEnabled(false);
    startMove(
      event.position,
      {x: mouseEvent.clientX, y: mouseEvent.clientY},
      {kind: 'node', id: node.id()},
      keptSelection,
      mouseEvent.shiftKey,
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

    graphSelection.select({nodeIds: [node.id()]});

    if (containsPoint(boundsToBox(bounds), event.position)) {
      props.onEditNode(node.id());
    } else {
      startNodeRename(node.id());
    }
  }

  // A double-click on a link renames the interface at the closer end
  function onEdgeDoubleClick(event: cytoscape.EventObject) {
    const edge = event.target as EdgeSingular;
    if (graphSelection.isHandActive || !isDoubleTapOnSameTarget()) return;

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
      graphSelection.select({groupIds: [hit.group.id]});
      startGroupRename(hit.group);
    }
  }

  function onEdgeContext(event: cytoscape.EventObject) {
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
          topologyStore.manager.deleteElements([], [Number(edge.id())], [], []),
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
                ...arrangeActions,
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
    pendingMenuEvent.current = event;
  }

  function currentSelectionMenu() {
    return selectionMenu({
      ...clipboardActions,
      count: graphSelection.count,
      canGroup: graphSelection.count > 0,
      canReorder: graphSelection.layerIds.length > 0,
      onGroup: onGroupSelection,
      ...arrangeActions,
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
      ...arrangeActions,
      onUngroup: onUngroup,
      onDelete: onDeleteSelection,
    });
  }

  /**
   * The elements that move on their own are dropped at the pointer, so they all
   * end up in the group under it. Without a pointer, e.g. when they are nudged,
   * each element is dropped by its center.
   */
  function planSelectionDrop(
    starts: SelectionStarts,
    transform: SelectionTransform,
    pointer: Position | null,
    isFinal: boolean,
  ): DropPlan {
    const cy = cyRef.current!;
    const boxes = transformedGroupBoxes(starts, transform);

    const elements = starts.freeElements.map((element): DroppedElement => {
      switch (element.kind) {
        case 'node': {
          const position = cy.getElementById(element.id).position();
          return {element, box: nodeBox(position), center: position};
        }
        case 'group': {
          const box = boxes.get(element.id)!;
          return {element, box, center: boxCenter(box)};
        }
        case 'shape': {
          const box = shapeBox(
            transformShapeGeometry(starts.shapes.get(element.id)!, transform),
          );
          return {element, box, center: boxCenter(box)};
        }
        case 'text': {
          const text = transformText(starts.texts.get(element.id)!, transform);
          const size = graphSelection.textSizes.get(element.id);
          const box = {
            ...text.position!,
            width: text.width ?? size?.width ?? 0,
            height: text.height ?? size?.height ?? 0,
          };
          return {element, box, center: boxCenter(box)};
        }
      }
    });

    return planDrop(
      pointer
        ? elements.map(element => ({...element, center: pointer}))
        : elements,
      isDragCtrl.current,
      new Set(starts.boxes.keys()),
      isFinal,
    );
  }

  /**
   * Plans where the given elements end up. A group that elements are added to
   * only grows once they are dropped, so it doesn't change while they pass it.
   */
  function planDrop(
    elements: DroppedElement[],
    isCtrl: boolean,
    movedGroupIds: Set<string>,
    isFinal: boolean,
  ): DropPlan {
    // Groups that move along can't be dropped into
    const targetGroups = groupsRef.current.filter(
      group => !movedGroupIds.has(group.id),
    );
    const parentIds = currentParentIds();
    const groupIds = new Map<string, string | null>();
    const groupBoxes = new Map<string, Box>();

    // The group each element would end up in without ctrl
    const joinedGroupIds = new Map<string, string | null>();

    for (const {element, box, center} of elements) {
      const key = elementKey(element);
      const currentGroupId = parentIds.get(key) ?? null;
      const joinedGroupId = groupAt(targetGroups, center)?.id ?? currentGroupId;

      // Ctrl keeps elements out of all groups, it leaves the current one and joins none
      const groupId = isCtrl ? null : joinedGroupId;

      joinedGroupIds.set(key, joinedGroupId);
      groupIds.set(key, groupId);
      if (groupId !== null && (isFinal || groupId === currentGroupId)) {
        growAncestors(groupId, box, groupBoxes);
      }
    }

    if (elements.length === 0) {
      return {groupIds, groupBoxes, hint: null, dropTargetId: null};
    }

    const target = elementKey(elements[0].element);
    const label =
      elements.length > 1
        ? 'the selection'
        : `the ${ELEMENT_LABELS[elements[0].element.kind]}`;
    const currentGroupId = parentIds.get(target) ?? null;
    const joinedGroupId = joinedGroupIds.get(target) ?? null;

    let hint: HintPart[] | null = null;
    let dropTargetId: string | null = null;

    if (isCtrl && currentGroupId !== null) {
      hint = [{keyword: 'Drop'}, ` to move ${label} out of the group`];
    } else if (isCtrl && joinedGroupId !== null) {
      hint = [{keyword: 'Drop'}, ` to keep ${label} out of groups`];
    } else if (joinedGroupId !== null && joinedGroupId !== currentGroupId) {
      hint = [
        {keyword: 'Drop'},
        ` to add ${label} to the group · Hold `,
        {keyword: 'Ctrl'},
        ' to keep it out',
      ];
      dropTargetId = joinedGroupId;
    } else if (currentGroupId !== null) {
      hint = ['Hold ', {keyword: 'Ctrl'}, ` to move ${label} out of the group`];
    }

    return {groupIds, groupBoxes, hint, dropTargetId};
  }

  /**
   * Grows the group and the groups around it so they contain the given box. The
   * grown boxes are collected in the given map, which they also grow from.
   */
  function growAncestors(
    groupId: string | null,
    box: Box,
    boxes: Map<string, Box>,
  ): Map<string, Box> {
    let id = groupId;
    let inner = box;

    while (id !== null) {
      const group = groupsRef.current.find(group => group.id === id);
      if (!group) break;

      const current = boxes.get(group.id) ?? group;
      const grown = growGroupBox(current, [inner]);
      if (grown === current) break;

      boxes.set(group.id, grown);
      inner = grown;
      id = group.parentId;
    }

    return boxes;
  }

  // The group each element is directly in, by element key
  function currentParentIds(): Map<string, string> {
    const parentIds = new Map<string, string>();

    for (const group of groupsRef.current) {
      for (const element of directMembers(group)) {
        parentIds.set(elementKey(element), group.id);
      }
    }

    return parentIds;
  }

  function directMembers(group: GraphGroup): ElementRef[] {
    return [
      ...group.memberIds.map(id => ({kind: 'node' as const, id})),
      ...group.groupIds.map(id => ({kind: 'group' as const, id})),
      ...group.shapeIds.map(id => ({kind: 'shape' as const, id})),
      ...group.textIds.map(id => ({kind: 'text' as const, id})),
    ];
  }

  // All nodes, groups, shapes and texts of the graph
  function allElements(): ElementRef[] {
    return [
      ...(cyRef.current
        ?.nodes('.topology-node')
        .map(node => ({kind: 'node' as const, id: node.id()})) ?? []),
      ...groupsRef.current.map(group => ({
        kind: 'group' as const,
        id: group.id,
      })),
      ...layerItemsRef.current
        .filter(item => item.kind === 'shape')
        .map(item => ({kind: 'shape' as const, id: item.id})),
      ...textsRef.current.map(text => ({kind: 'text' as const, id: text.id})),
    ];
  }

  // The box an element takes up as it is stored, or null if it doesn't exist
  function elementBox(element: ElementRef): Box | null {
    switch (element.kind) {
      case 'node': {
        const node = cyRef.current?.getElementById(element.id);
        return node?.nonempty() ? nodeBox(node.position()) : null;
      }
      case 'group':
        return groupsRef.current.find(group => group.id === element.id) ?? null;
      case 'shape': {
        const item = findLayerItem(element.id);
        return item?.kind === 'shape'
          ? shapeBox(shapeGeometry(item.shape.annotation))
          : null;
      }
      case 'text': {
        const text = textsRef.current.find(text => text.id === element.id);
        if (!text) return null;

        return (
          textBox(text.annotation, graphSelection.textSizes.get(text.id)) ??
          storedTextBox(text.annotation)
        );
      }
    }
  }

  // A node is dropped by its icon, the other elements by the center of their box
  function elementCenter(element: ElementRef, box: Box): Position {
    return element.kind === 'node'
      ? cyRef.current!.getElementById(element.id).position()
      : boxCenter(box);
  }

  /**
   * Adds a group with the given box and members, nested in the given group, and
   * starts renaming it. The groups around it grow to contain it.
   */
  function createGroup(
    box: Box,
    members: ElementRef[],
    parentId: string | null,
  ) {
    const cy = cyRef.current;
    if (!cy) return;

    const name = `Group ${groupsRef.current.length + 1}`;
    const grownBoxes = growAncestors(parentId, box, new Map());
    const idsOf = (kind: ElementKind) =>
      members.filter(member => member.kind === kind).map(member => member.id);

    const groupId = topologyStore.manager.addGroup(
      {
        name,
        position: {x: box.x, y: box.y},
        width: box.width,
        height: box.height,
      },
      parentId,
      groupId => ({
        nodes: new Map(
          idsOf('node').map(id => [
            id,
            {position: cy.getElementById(id).position(), groupId},
          ]),
        ),
        groups: new Map<string, Partial<GroupStyleAnnotation>>([
          ...boxUpdates(grownBoxes),
          ...idsOf('group').map(
            id => [id, groupParentUpdate(groupId)] as const,
          ),
        ]),
        shapes: new Map(idsOf('shape').map(id => [id, {groupId}])),
        texts: new Map(idsOf('text').map(id => [id, {groupId}])),
      }),
    );
    if (groupId === null) return;

    graphSelection.select({groupIds: [groupId]});
    startGroupRename({id: groupId, name, annotation: null, ...box});
  }

  // Nudged nodes that move on their own grow and join groups like dragged nodes
  function onNudge(delta: Position) {
    const cy = cyRef.current;
    if (!cy || graphSelection.count === 0) return;

    commitTransform(
      selectionStarts(cy, null),
      translateTransform(delta),
      null,
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

    // Groups are copied with everything inside them
    const contents = graphSelection.groupIds.flatMap(contentElements);
    const copiedIds = (kind: ElementKind, selected: string[]) =>
      new Set([
        ...selected,
        ...contents
          .filter(element => element.kind === kind)
          .map(element => element.id),
      ]);

    const groupIds = copiedIds('group', graphSelection.groupIds);
    const shapeIds = copiedIds('shape', graphSelection.shapeIds);
    const textIds = copiedIds('text', graphSelection.textIds);
    const nodeNames = copiedIds('node', graphSelection.nodeIds);
    const groups = groupsRef.current.filter(group => groupIds.has(group.id));

    // Groups of old topologies don't have an annotation, their members are copied without them
    const copiedGroupIds = new Set(
      groups.filter(group => group.annotation).map(group => group.id),
    );
    const memberGroupIds = currentGroupIds();

    // The nodes and links are copied as they are written
    const definition = topology.definition.document.toJS() as {
      topology?: {nodes?: Record<string, unknown>; links?: unknown[]};
    };
    const links = topology.definition.links
      .filter(
        link =>
          link.isBetweenNodes &&
          link.endpoints.every(endpoint => nodeNames.has(endpoint.node)),
      )
      .map(link => definition.topology?.links?.[link.index]);

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
      shapes: layerItemsRef.current
        .filter(item => item.kind === 'shape')
        .filter(item => shapeIds.has(item.id))
        .map(item => item.shape.annotation),
      texts: textsRef.current
        .filter(text => textIds.has(text.id))
        .map(text => text.annotation),
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

  function onStep(isForward: boolean) {
    topologyStore.manager.stepAnnotations(graphSelection.layerIds, isForward);
  }

  function onReorder(toFront: boolean) {
    topologyStore.manager.reorderAnnotations(graphSelection.layerIds, toFront);
  }

  // Selects the group with everything inside it
  function onSelectMembers() {
    const group = groupsRef.current.find(
      group => group.id === menuTargetRef.current,
    );
    if (!group) return;

    const contents = groupContents(groupsRef.current, group.id);
    graphSelection.select({
      ...contents,
      groupIds: [group.id, ...contents.groupIds],
    });
  }

  function onDeleteSelection() {
    const cy = cyRef.current;
    if (!cy || graphSelection.count === 0) return;

    const deletedGroups = groupsRef.current.filter(group =>
      graphSelection.groupIds.includes(group.id),
    );
    const nodeNames = graphSelection.nodeIds;
    const annotationIds = [
      ...graphSelection.shapeIds,
      ...graphSelection.textIds,
    ];

    // The contents of deleted groups are kept, the selection is cleared after the change for undo
    topologyStore.manager.deleteElements(
      nodeNames,
      [],
      deletedGroups.map(group => group.id),
      annotationIds,
    );
    graphSelection.clear();
  }

  // The group takes the place of its members in the group they all share
  function onGroupSelection() {
    const cy = cyRef.current;
    if (!cy) return;

    const members = selectionStarts(cy, null).freeElements;
    const box = groupBoxAroundBoxes(
      members.map(elementBox).filter(box => box !== null),
    );
    if (!box) return;

    const parentIds = currentParentIds();
    const memberParentIds = new Set(
      members.map(member => parentIds.get(elementKey(member)) ?? null),
    );

    createGroup(
      box,
      members,
      memberParentIds.size === 1 ? [...memberParentIds][0] : null,
    );
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
      position: boundsCenter(
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
      position: boundsCenter(
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
  function startGroupRename(
    group: Pick<GraphGroup, 'id' | 'name' | 'annotation'> & Box,
  ) {
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
          props.openTopology?.definition.links ?? [],
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
      case 'text':
        onResizeAnnotation(item, box, isFinal);
        break;
    }
  }

  /**
   * Moves the lines attached to a resized shape or text while it is resized,
   * Moveable resizes the element itself. Once it ends, the box is saved and
   * the groups around it grow to contain it.
   */
  function onResizeAnnotation(
    item: Extract<AnnotationItem, {kind: 'shape' | 'text'}>,
    box: Box,
    isFinal: boolean,
  ) {
    const annotation =
      item.kind === 'shape' ? item.shape.annotation : item.text.annotation;
    const grown = isFinal
      ? growAncestors(annotation.groupId ?? null, box, new Map())
      : new Map<string, Box>();

    const key = elementKey({kind: item.kind, id: item.id});
    const attachments = (resizeAttachments.current ??= currentAttachments(
      new Set(),
    ));
    const lines = followLines(attachments, attachment => {
      if (attachment.key === key) return box;

      const [kind, id] = splitElementKey(attachment.key);
      return kind === 'group' ? grown.get(id) : undefined;
    });

    if (!isFinal) {
      graphSelection.setShapePreviews(lines);
      return;
    }

    resizeAttachments.current = null;
    graphSelection.setShapePreviews(new Map());
    topologyStore.manager.updateLayout({
      shapes: new Map<string, Partial<FreeShapeAnnotation>>([
        ...(item.kind === 'shape' ? [[item.id, boxFields(box)] as const] : []),
        ...lines,
      ]),
      texts:
        item.kind === 'text' ? new Map([[item.id, boxFields(box)]]) : undefined,
      groups: boxUpdates(grown),
    });
  }

  /**
   * Moves the members of the resized group together, so they stay inside its
   * new box while it is resized. Members that still don't fit are moved to its
   * edge, nested groups move with everything inside them. The box and the
   * members are saved once it ends, the groups around it grow to contain it.
   */
  function onResizeGroup(group: GraphGroup, box: Box, isFinal: boolean) {
    const cy = cyRef.current;
    if (!cy) return;

    const starts = (groupResizeStarts.current ??= readGroupResizeStarts(
      cy,
      group,
    ));
    const inner = groupInnerBox(box);
    const content = unionBox([...starts.memberBoxes.values()]);
    const shift = content ? shiftIntoBox(inner, content) : {x: 0, y: 0};

    const deltas = new Map(
      [...starts.memberBoxes].map(([key, memberBox]) => {
        const edge = shiftIntoBox(inner, moveBox(memberBox, shift));
        return [key, {x: shift.x + edge.x, y: shift.y + edge.y}];
      }),
    );
    const moveOf = (kind: ElementKind, id: string) =>
      translateTransform(
        deltas.get(starts.owners.get(elementKey({kind, id}))!) ?? {x: 0, y: 0},
      );

    const {contents} = starts;
    const memberGroupIds = currentGroupIds();
    const nodeLayouts = new Map<string, NodeLayout>(
      [...contents.memberPositions].map(([id, start]) => [
        id,
        {
          position: roundPosition(moveOf('node', id).position(start)),
          groupId: memberGroupIds.get(id) ?? null,
        },
      ]),
    );
    const groupBoxes = new Map(
      [...contents.boxes].map(([id, start]) => [
        id,
        moveOf('group', id).box(start),
      ]),
    );
    const shapes = new Map(
      [...contents.shapes].map(([id, geometry]) => [
        id,
        transformShapeGeometry(geometry, moveOf('shape', id)),
      ]),
    );
    const texts = new Map(
      [...contents.texts].map(([id, start]) => [
        id,
        transformText(start, moveOf('text', id)),
      ]),
    );

    cy.batch(() => {
      for (const [nodeId, layout] of nodeLayouts) {
        cy.getElementById(nodeId).position(layout.position);
      }
    });

    // The groups around the group grow to contain it once it is saved
    const changedGroups = new Map([
      ...groupBoxes,
      [group.id, box],
      ...(isFinal ? growAncestors(group.parentId, box, new Map()) : []),
    ]);
    const lines = followedLines(contents, moveOf, changedGroups);

    if (!isFinal) {
      graphSelection.setDrag(null, null, groupBoxes);
      graphSelection.setShapePreviews(new Map([...shapes, ...lines]));
      graphSelection.setTextPreviews(texts);
      return;
    }

    groupResizeStarts.current = null;
    graphSelection.clearDrag();
    topologyStore.manager.updateLayout({
      nodes: nodeLayouts,
      groups: boxUpdates(changedGroups),
      shapes: new Map([...shapes, ...lines]),
      texts,
    });
  }

  function readGroupResizeStarts(
    cy: cytoscape.Core,
    group: GraphGroup,
  ): GroupResizeStarts {
    const starts: GroupResizeStarts = {
      memberBoxes: new Map(),
      contents: {
        boxes: new Map(),
        shapes: new Map(),
        texts: new Map(),
        memberPositions: new Map(),
        freeElements: [],
        attachments: [],
      },
      owners: new Map(),
    };

    for (const member of directMembers(group)) {
      const box = elementBox(member);
      if (!box) continue;

      const key = elementKey(member);
      starts.memberBoxes.set(key, box);

      const nested = member.kind === 'group' ? contentElements(member.id) : [];
      for (const element of [member, ...nested]) {
        starts.owners.set(elementKey(element), key);
        addStart(starts.contents, element, cy);
      }
    }

    starts.contents.attachments = currentAttachments(
      new Set(starts.contents.shapes.keys()),
    );

    return starts;
  }

  // A group can't get smaller than any of its members
  function groupMinSize(group: GraphGroup): Size | null {
    const boxes = directMembers(group)
      .map(elementBox)
      .filter(box => box !== null);

    return boxes.length > 0 ? minGroupSize(boxes) : null;
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
      commitTransform(starts, transform, null);
      return;
    }

    transformNodes(starts, transform);
    transformPreviews(starts, transform, null);
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

  // Whether the press is with the left button on a node of the graph
  function isNodePress(event: globalThis.MouseEvent): boolean {
    const cy = cyRef.current;
    if (
      !cy ||
      event.button !== 0 ||
      !cy.container()?.contains(event.target as Node)
    ) {
      return false;
    }

    return elementsAt(toGraphPosition(cy, event.clientX, event.clientY)).some(
      element => element.kind === 'node',
    );
  }

  function exitConnectionMode() {
    nodeConnectionSource.current = null;
    graphSelection.setConnectionLine(null);
  }

  const arrangeActions: ArrangeOptions = {
    onBringToFront: () => onReorder(true),
    onBringForward: () => onStep(true),
    onBringBackward: () => onStep(false),
    onSendToBack: () => onReorder(false),
  };

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
    onBringForward: () => onStep(true),
    onBringBackward: () => onStep(false),
    onSendToBack: () => onReorder(false),
    onUngroup,
    onDeleteSelection,
    onResize,
    getSelectionBox: () => selectionLayerRef.current?.frameBox() ?? null,
    getGroupMinSize: groupMinSize,
    getSnapTargets: resizeSnapTargets,
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
              onBringForward={callbacks.onBringForward}
              onBringBackward={callbacks.onBringBackward}
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
        getGroupMinSize={callbacks.getGroupMinSize}
        getSnapTargets={callbacks.getSnapTargets}
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
        readOnly={isReadOnly}
      />
      <If condition={isReadOnly}>
        <div className="sb-node-editor-readonly">
          The current file is opened in read-only mode.
        </div>
      </If>
      <SimulationPanel onStabilizeGraph={callbacks.onStabilizeGraph} />
      <SBContextMenu
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

function boundsCenter(bounds: cytoscape.BoundingBox12): Position {
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

function elementKey(element: ElementRef) {
  return `${element.kind}:${element.id}`;
}

function splitElementKey(key: string): [ElementKind, string] {
  const index = key.indexOf(':');
  return [key.slice(0, index) as ElementKind, key.slice(index + 1)];
}

// Selects only the given element
function itemSelection(
  kind: ElementKind,
  id: string,
): Partial<GraphSelectionSnapshot> {
  return {
    nodeIds: kind === 'node' ? [id] : [],
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
