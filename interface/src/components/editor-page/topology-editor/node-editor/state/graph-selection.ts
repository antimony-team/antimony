import {createContext, useContext} from 'react';

import {action, computed, observable} from 'mobx';

import {
  AnnotationItem,
  Box,
  DrawKind,
  DrawnShape,
  shapeBox,
  ShapeGeometry,
  shapeGeometry,
  Size,
  textBox,
} from '@sb/lib/graph/annotation-geometry';
import {AnnotationStyle} from '@sb/lib/graph/annotation-style';
import {GraphSelectionSnapshot} from '@sb/lib/topology-history';
import {FreeTextAnnotation} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

export enum GraphTool {
  Select,
  Hand,
  Rectangle,
  Ellipse,
  Line,
  Text,
  Group,
}

// What each drawing tool draws
export const TOOL_DRAW_KINDS = new Map<GraphTool, DrawKind>([
  [GraphTool.Rectangle, 'rectangle'],
  [GraphTool.Ellipse, 'circle'],
  [GraphTool.Line, 'line'],
  [GraphTool.Text, 'text'],
  [GraphTool.Group, 'group'],
]);

// A part of a hint, keywords like the keys to press are highlighted
export type HintPart = string | {keyword: string};

export enum LabelKind {
  Group,
  Node,
  Interface,
}

/**
 * A label that is edited in place in the graph.
 */
export interface LabelEdit {
  kind: LabelKind;

  // The ID of the group, node or link
  id: string;

  // The end of the link whose interface is edited, 0 for its first endpoint
  endpointIndex?: number;

  value: string;

  // Where the field is shown in the graph, the center of the label or the top left of a group label
  position: Position;
}

/**
 * The selection and the interaction state of the graph. All elements are
 * selected here, cytoscape doesn't select anything itself.
 */
export class GraphSelection {
  @observable accessor tool: GraphTool = GraphTool.Select;

  // Whether the hand is held temporarily, with space or the middle mouse button
  @observable accessor isHandHeld: boolean = false;

  @observable accessor nodeIds: string[] = [];
  @observable accessor groupIds: string[] = [];
  @observable accessor shapeIds: string[] = [];
  @observable accessor textIds: string[] = [];

  // Whether elements are currently dragged, resized or selected with a box
  @observable accessor isInteracting: boolean = false;

  // Whether the selected groups, shapes and texts are dragged, their handles are hidden meanwhile
  @observable accessor isMoving: boolean = false;

  // The group that the dragged nodes are added to when they are dropped
  @observable accessor dropTargetId: string | null = null;

  /*
   * The boxes of groups while they are dragged or grow, by group ID. The map is
   * changed in place, so only the views that read a box update on every frame.
   */
  public readonly groupPreviews = observable.map<string, Box>();

  // The geometry of shapes while they are dragged or resized, by shape ID
  public readonly shapePreviews = observable.map<string, ShapeGeometry>();

  // Style changes of groups and shapes that aren't saved yet, e.g. while scrubbing
  public readonly stylePreviews = observable.map<
    string,
    Partial<AnnotationStyle>
  >();

  // Changes of texts that aren't saved yet, e.g. while they are moved, by text ID
  public readonly textPreviews = observable.map<
    string,
    Partial<FreeTextAnnotation>
  >();

  // The rendered sizes of the texts by text ID, their height follows the text
  public readonly textSizes = observable.map<string, Size>();

  @observable accessor editingTextId: string | null = null;

  // The box of the annotation that Moveable resizes, which changes the element directly
  @observable accessor resizePreview: {id: string; box: Box} | null = null;

  // Selected once the graph shows its elements, e.g. after a paste or an undo
  @observable accessor pendingSelection: GraphSelectionSnapshot | null = null;

  // The shape that is currently drawn with a drawing tool
  @observable accessor drawPreview: DrawnShape | null = null;

  // The label that is edited in place, its label in the graph is hidden meanwhile
  @observable accessor labelEdit: LabelEdit | null = null;

  // Shown in the status bar while elements are dragged
  @observable accessor dragHint: HintPart[] | null = null;

  // The line from a node to the pointer while a link is drawn from the node
  @observable.ref accessor connectionLine: {
    sourceId: string;
    pointer: Position;
  } | null = null;

  // The box that is drawn to select elements, in coordinates of the graph's container
  @observable accessor selectionBox: Box | null = null;

  @observable accessor isContextMenuOpen: boolean = false;

  // The link whose context menu is open, it is highlighted meanwhile
  @observable accessor menuEdgeId: string | null = null;

  @observable accessor zoom: number = 1;

  constructor() {
    this.setTool = this.setTool.bind(this);
  }

  @computed
  public get isHandActive() {
    return this.tool === GraphTool.Hand || this.isHandHeld;
  }

  @computed
  public get isDrawToolActive() {
    return TOOL_DRAW_KINDS.has(this.tool) && !this.isHandHeld;
  }

  @computed
  public get count() {
    return (
      this.nodeIds.length +
      this.groupIds.length +
      this.shapeIds.length +
      this.textIds.length
    );
  }

  // The selected groups and shapes
  @computed
  public get layerIds() {
    return [...this.groupIds, ...this.shapeIds];
  }

  // The selected groups, shapes and texts
  @computed
  public get annotationIds() {
    return [...this.layerIds, ...this.textIds];
  }

  /*
   * The annotation that shows handles to resize it, which is the case if it is
   * selected alone. Lines show a handle at each end instead.
   */
  @computed
  public get transformTargetId() {
    return this.annotationIds.length === 1 &&
      this.count === 1 &&
      !this.isHandActive &&
      !this.isMoving
      ? this.annotationIds[0]
      : null;
  }

  // Whether the handles resize the whole selection, which is the case for more than one element
  @computed
  public get isSelectionTransformTarget() {
    return this.count > 1 && !this.isHandActive && !this.isMoving;
  }

  @action
  public setTool(tool: GraphTool) {
    this.tool = tool;
  }

  @action
  public setHandHeld(isHandHeld: boolean) {
    this.isHandHeld = isHandHeld;
  }

  // Replaces the selection, lists that aren't given are cleared
  @action
  public select(selection: Partial<GraphSelectionSnapshot>) {
    this.nodeIds = selection.nodeIds ?? [];
    this.groupIds = selection.groupIds ?? [];
    this.shapeIds = selection.shapeIds ?? [];
    this.textIds = selection.textIds ?? [];
  }

  @action
  public add(selection: Partial<GraphSelectionSnapshot>) {
    const added = (selected: string[], ids: string[] = []) => [
      ...new Set([...selected, ...ids]),
    ];

    this.nodeIds = added(this.nodeIds, selection.nodeIds);
    this.groupIds = added(this.groupIds, selection.groupIds);
    this.shapeIds = added(this.shapeIds, selection.shapeIds);
    this.textIds = added(this.textIds, selection.textIds);
  }

  @action
  public clear() {
    this.select({});
  }

  // Removes elements that don't exist anymore, e.g. after an undo
  @action
  public retain(ids: Set<string>) {
    if ([...this.nodeIds, ...this.annotationIds].every(id => ids.has(id))) {
      return;
    }

    this.nodeIds = this.nodeIds.filter(id => ids.has(id));
    this.groupIds = this.groupIds.filter(id => ids.has(id));
    this.shapeIds = this.shapeIds.filter(id => ids.has(id));
    this.textIds = this.textIds.filter(id => ids.has(id));
  }

  @action
  public setGroups(groupIds: string[]) {
    this.groupIds = groupIds;
  }

  @action
  public toggleNode(nodeId: string) {
    this.nodeIds = toggled(this.nodeIds, nodeId);
  }

  @action
  public toggleGroup(groupId: string) {
    this.groupIds = toggled(this.groupIds, groupId);
  }

  @action
  public toggleShape(shapeId: string) {
    this.shapeIds = toggled(this.shapeIds, shapeId);
  }

  @action
  public toggleText(textId: string) {
    this.textIds = toggled(this.textIds, textId);
  }

  @action
  public setEditingText(textId: string | null) {
    this.editingTextId = textId;
  }

  @action
  public setTextSize(textId: string, size: Size) {
    this.textSizes.set(textId, size);
  }

  @action
  public setTextPreviews(
    textPreviews: Map<string, Partial<FreeTextAnnotation>>,
  ) {
    this.textPreviews.replace(textPreviews);
  }

  @action
  public setInteracting(isInteracting: boolean) {
    this.isInteracting = isInteracting;
  }

  @action
  public setMoving(isMoving: boolean) {
    this.isMoving = isMoving;
  }

  @action
  public setPendingSelection(pendingSelection: GraphSelectionSnapshot | null) {
    this.pendingSelection = pendingSelection;
  }

  @action
  public setResizePreview(resizePreview: {id: string; box: Box} | null) {
    this.resizePreview = resizePreview;
  }

  @action
  public setDrag(
    hint: HintPart[] | null,
    dropTargetId: string | null,
    groupPreviews: Map<string, Box>,
  ) {
    this.dragHint = hint;
    this.dropTargetId = dropTargetId;

    for (const id of [...this.groupPreviews.keys()]) {
      if (!groupPreviews.has(id)) this.groupPreviews.delete(id);
    }

    for (const [id, box] of groupPreviews) {
      const current = this.groupPreviews.get(id);
      if (!current || !isSameBox(current, box)) this.groupPreviews.set(id, box);
    }
  }

  @action
  public setShapePreviews(shapePreviews: Map<string, ShapeGeometry>) {
    for (const id of [...this.shapePreviews.keys()]) {
      if (!shapePreviews.has(id)) this.shapePreviews.delete(id);
    }

    for (const [id, geometry] of shapePreviews) {
      this.shapePreviews.set(id, geometry);
    }
  }

  @action
  public clearDrag() {
    this.dragHint = null;
    this.dropTargetId = null;
    this.groupPreviews.clear();
    this.shapePreviews.clear();
    this.textPreviews.clear();
  }

  @action
  public setDrawPreview(drawPreview: DrawnShape | null) {
    this.drawPreview = drawPreview;
  }

  /**
   * Shows the given style on the given groups and shapes until it is cleared,
   * without saving it.
   */
  @action
  public setStylePreview(
    ids: string[],
    style: Partial<AnnotationStyle> | null,
  ) {
    this.stylePreviews.clear();
    if (!style) return;

    for (const id of ids) this.stylePreviews.set(id, style);
  }

  /**
   * Returns the box of a group, shape or text as it is shown, previews included.
   * Returns null for texts that weren't rendered yet.
   */
  public annotationBox(item: AnnotationItem): Box | null {
    switch (item.kind) {
      case 'group':
        return this.groupPreviews.get(item.id) ?? item.group;
      case 'shape':
        return shapeBox(
          this.shapePreviews.get(item.id) ??
            shapeGeometry(item.shape.annotation),
        );
      case 'text':
        return textBox(
          {...item.text.annotation, ...this.textPreviews.get(item.id)},
          this.textSizes.get(item.id),
        );
    }
  }

  @computed
  public get snapshot(): GraphSelectionSnapshot {
    return {
      nodeIds: this.nodeIds,
      groupIds: this.groupIds,
      shapeIds: this.shapeIds,
      textIds: this.textIds,
    };
  }

  @computed
  public get renamingGroupId() {
    return this.labelEdit?.kind === LabelKind.Group ? this.labelEdit.id : null;
  }

  @action
  public setLabelEdit(labelEdit: LabelEdit | null) {
    this.labelEdit = labelEdit;
  }

  @action
  public setConnectionLine(
    connectionLine: {sourceId: string; pointer: Position} | null,
  ) {
    this.connectionLine = connectionLine;
  }

  @action
  public setSelectionBox(selectionBox: Box | null) {
    this.selectionBox = selectionBox;
  }

  @action
  public setContextMenuOpen(isContextMenuOpen: boolean) {
    this.isContextMenuOpen = isContextMenuOpen;
    if (!isContextMenuOpen) this.menuEdgeId = null;
  }

  @action
  public setMenuEdge(edgeId: string | null) {
    this.menuEdgeId = edgeId;
  }

  @action
  public setZoom(zoom: number) {
    this.zoom = zoom;
  }
}

function toggled(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];
}

function isSameBox(a: Box, b: Box) {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

export const GraphSelectionContext = createContext({} as GraphSelection);

export const useGraphSelection = () => {
  return useContext(GraphSelectionContext);
};
