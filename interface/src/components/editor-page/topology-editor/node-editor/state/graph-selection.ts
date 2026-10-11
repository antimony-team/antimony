import {createContext, useContext} from 'react';

import {action, computed, observable} from 'mobx';

import {Box} from '@sb/lib/graph/annotation-geometry';

export enum GraphTool {
  Select,
  Hand,
}

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

  @observable accessor renamingGroupId: string | null = null;

  // Shown in the status bar while elements are dragged
  @observable accessor dragHint: string | null = null;

  // The box that is drawn to select elements, in coordinates of the graph's container
  @observable accessor selectionBox: Box | null = null;

  @observable accessor isContextMenuOpen: boolean = false;

  // Changes whenever the graph is panned or zoomed
  @observable accessor zoom: number = 1;
  @observable accessor viewportVersion: number = 0;

  constructor() {
    this.setTool = this.setTool.bind(this);
  }

  @computed
  public get isHandActive() {
    return this.tool === GraphTool.Hand || this.isHandHeld;
  }

  @computed
  public get count() {
    return this.nodeIds.length + this.edgeIds.length + this.groupIds.length;
  }

  // The group that shows resize handles, which is the case if it is selected alone
  @computed
  public get resizableGroupId() {
    return this.groupIds.length === 1 &&
      this.count === 1 &&
      !this.isHandActive &&
      !this.isPointerDown &&
      !this.renamingGroupId &&
      !this.isContextMenuOpen
      ? this.groupIds[0]
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
  public toggleGroup(groupId: string) {
    this.groupIds = this.groupIds.includes(groupId)
      ? this.groupIds.filter(id => id !== groupId)
      : [...this.groupIds, groupId];
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
  public clearDrag() {
    this.dragHint = null;
    this.dropTargetId = null;
    this.groupPreviews.clear();
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
  public setViewport(zoom: number) {
    this.zoom = zoom;
    this.viewportVersion++;
  }
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
