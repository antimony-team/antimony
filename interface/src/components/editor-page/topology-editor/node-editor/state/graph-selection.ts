import {createContext, useContext} from 'react';

import {action, computed, observable} from 'mobx';

import {
  Box,
  DrawKind,
  DrawnShape,
  ShapeGeometry,
  TextSize,
} from '@sb/lib/graph/annotation-geometry';
import {AnnotationStyle} from '@sb/lib/graph/annotation-style';
import {FreeTextAnnotation} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

export enum GraphTool {
  Select,
  Hand,
  Rectangle,
  Ellipse,
  Line,
  Text,
}

// What each drawing tool draws
export const TOOL_DRAW_KINDS = new Map<GraphTool, DrawKind>([
  [GraphTool.Rectangle, 'rectangle'],
  [GraphTool.Ellipse, 'circle'],
  [GraphTool.Line, 'line'],
  [GraphTool.Text, 'text'],
]);

/**
 * The selection and the interaction state of the graph. Nodes and links are
 * selected in cytoscape, their IDs are mirrored here so the view can react to
 * them.
 */
export class GraphSelection {
  @observable accessor tool: GraphTool = GraphTool.Select;

  // Whether the hand is held temporarily, with space or the middle mouse button
  @observable accessor isHandHeld: boolean = false;

  @observable accessor nodeIds: string[] = [];
  @observable accessor edgeIds: string[] = [];
  @observable accessor groupIds: string[] = [];
  @observable accessor shapeIds: string[] = [];
  @observable accessor textIds: string[] = [];

  // Whether elements are currently dragged, resized or selected with a box
  @observable accessor isInteracting: boolean = false;

  /*
   * Whether the mouse button is held in the graph. The bar and the resize handles
   * only appear once it is released, so they are never mounted at the start of a
   * drag.
   */
  @observable accessor isPointerDown: boolean = false;

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
  public readonly textSizes = observable.map<string, TextSize>();

  @observable accessor editingTextId: string | null = null;

  // The shape that is currently drawn with a drawing tool
  @observable accessor drawPreview: DrawnShape | null = null;

  @observable accessor renamingGroupId: string | null = null;

  // Shown in the status bar while elements are dragged
  @observable accessor dragHint: string | null = null;

  // The box that is drawn to select elements, in coordinates of the graph's container
  @observable accessor selectionBox: Box | null = null;

  @observable accessor isContextMenuOpen: boolean = false;

  // Changes whenever the graph is panned or zoomed
  @observable accessor zoom: number = 1;
  @observable accessor pan: Position = {x: 0, y: 0};
  @observable accessor viewportVersion: number = 0;

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
      this.edgeIds.length +
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
      !this.isPointerDown &&
      !this.renamingGroupId &&
      !this.editingTextId &&
      !this.isContextMenuOpen
      ? this.annotationIds[0]
      : null;
  }

  @action
  public setTool(tool: GraphTool) {
    this.tool = tool;
  }

  @action
  public setHandHeld(isHandHeld: boolean) {
    this.isHandHeld = isHandHeld;
  }

  @action
  public setElements(nodeIds: string[], edgeIds: string[]) {
    this.nodeIds = nodeIds;
    this.edgeIds = edgeIds;
  }

  @action
  public setGroups(groupIds: string[]) {
    this.groupIds = groupIds;
  }

  @action
  public setShapes(shapeIds: string[]) {
    this.shapeIds = shapeIds;
  }

  @action
  public setAnnotations(
    groupIds: string[],
    shapeIds: string[],
    textIds: string[],
  ) {
    this.groupIds = groupIds;
    this.shapeIds = shapeIds;
    this.textIds = textIds;
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
  public setTextSize(textId: string, size: TextSize) {
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
  public setPointerDown(isPointerDown: boolean) {
    this.isPointerDown = isPointerDown;
  }

  @action
  public setDrag(
    hint: string | null,
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

  @action
  public setRenamingGroup(groupId: string | null) {
    this.renamingGroupId = groupId;
  }

  @action
  public setSelectionBox(selectionBox: Box | null) {
    this.selectionBox = selectionBox;
  }

  @action
  public setContextMenuOpen(isContextMenuOpen: boolean) {
    this.isContextMenuOpen = isContextMenuOpen;
  }

  @action
  public setViewport(zoom: number, pan: Position) {
    this.zoom = zoom;
    this.pan = pan;
    this.viewportVersion++;
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
