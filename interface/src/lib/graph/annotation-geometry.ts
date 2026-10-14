import {groupStyle} from '@sb/lib/graph/annotation-style';
import {
  FreeShapeAnnotation,
  FreeTextAnnotation,
  GroupStyleAnnotation,
  NodeAnnotation,
} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

type GroupMembership = Pick<NodeAnnotation, 'groupId' | 'group' | 'level'>;

/**
 * A node of the graph with the fields that define its group.
 */
export interface GroupMember extends GroupMembership {
  name: string;
  position: Position;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A group as it is shown in the graph. Groups of legacy topologies only store
 * their membership on the nodes, their box is placed around their members.
 */
export interface GraphGroup extends Box {
  id: string;
  name: string;

  // The nodes, shapes, texts and groups that are directly inside the group
  memberIds: string[];
  shapeIds: string[];
  textIds: string[];
  groupIds: string[];

  // The group this group is nested in
  parentId: string | null;

  // Null for legacy groups that don't have an annotation yet
  annotation: GroupStyleAnnotation | null;
}

/**
 * A rectangle, ellipse or line as it is shown in the graph.
 */
export interface GraphShape {
  id: string;
  annotation: FreeShapeAnnotation;
}

// The fields of a shape that change when it is moved or resized
export type ShapeGeometry = Pick<
  FreeShapeAnnotation,
  'position' | 'width' | 'height' | 'endPosition'
>;

/**
 * A markdown text as it is shown in the graph, drawn above the nodes.
 */
export interface GraphText {
  id: string;
  annotation: FreeTextAnnotation;
}

export interface Size {
  width: number;
  height: number;
}

// What a drawing tool draws
export type DrawKind = FreeShapeAnnotation['shapeType'] | 'text' | 'group';

// A shape or text while it is drawn with a drawing tool
export interface DrawnShape {
  kind: DrawKind;
  geometry: ShapeGeometry;
}

/**
 * The groups and shapes of a graph in the order they are drawn, so groups and
 * shapes can be in front of each other.
 */
export type LayerItem =
  | {kind: 'group'; id: string; group: GraphGroup}
  | {kind: 'shape'; id: string; shape: GraphShape};

// Any annotation of the graph, texts are drawn in their own order above the nodes
export type AnnotationItem =
  | LayerItem
  | {kind: 'text'; id: string; text: GraphText};

// Size of a topology node in the graph, see cytoscape-styles.ts
const NODE_SIZE = 64;
const NODE_LABEL_HEIGHT = 25;

// The space between the box of a node and its icon, by the shape of the icon, see public/icons/nodes
const NODE_SHAPE_INSETS = new Map([
  ['ellipse', 2],
  ['octagon', 4.28],
]);

const GROUP_PADDING = 24;

const DEFAULT_SHAPE_WIDTH = 160;
const DEFAULT_SHAPE_HEIGHT = 100;
const DEFAULT_LINE_LENGTH = 160;

const DEFAULT_GROUP_WIDTH = 240;
const DEFAULT_GROUP_HEIGHT = 160;

const DEFAULT_TEXT_WIDTH = 240;
const DEFAULT_TEXT_HEIGHT = 60;

// The label sits in the top left corner of a group
const GROUP_LABEL_HEIGHT = 28;
const GROUP_LABEL_CHAR_WIDTH = 7.5;

export enum GroupHitPart {
  Label,
  Body,
}

/**
 * Returns the box of the icon of a node in the graph.
 */
export function nodeIconBox(position: Position): Box {
  return {
    x: position.x - NODE_SIZE / 2,
    y: position.y - NODE_SIZE / 2,
    width: NODE_SIZE,
    height: NODE_SIZE,
  };
}

/**
 * Returns the box of the visible shape of a node's icon, inside its icon box.
 */
export function nodeShapeBox(position: Position, shape: string): Box {
  return growBox(nodeIconBox(position), -(NODE_SHAPE_INSETS.get(shape) ?? 0));
}

/**
 * Returns the box a node takes up in the graph, including its label.
 */
export function nodeBox(position: Position): Box {
  return {
    x: position.x - NODE_SIZE / 2,
    y: position.y - NODE_SIZE / 2,
    width: NODE_SIZE,
    height: NODE_SIZE + NODE_LABEL_HEIGHT,
  };
}

/**
 * Returns the smallest box that contains all given boxes, or null if there are
 * none.
 */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;

  const x1 = Math.min(...boxes.map(box => box.x));
  const y1 = Math.min(...boxes.map(box => box.y));
  const x2 = Math.max(...boxes.map(box => box.x + box.width));
  const y2 = Math.max(...boxes.map(box => box.y + box.height));

  return {x: x1, y: y1, width: x2 - x1, height: y2 - y1};
}

/**
 * Returns the box of a group placed around the nodes at the given positions.
 */
export function groupBoxAround(positions: Position[]): Box | null {
  return groupBoxAroundBoxes(positions.map(nodeBox));
}

/**
 * Returns the box of a group placed around the given boxes of its members.
 */
export function groupBoxAroundBoxes(boxes: Box[]): Box | null {
  const box = unionBox(boxes);
  if (!box) return null;

  return {
    x: roundCoordinate(box.x - GROUP_PADDING),
    y: roundCoordinate(box.y - GROUP_PADDING - GROUP_LABEL_HEIGHT / 2),
    width: roundCoordinate(box.width + GROUP_PADDING * 2),
    height: roundCoordinate(
      box.height + GROUP_PADDING * 2 + GROUP_LABEL_HEIGHT / 2,
    ),
  };
}

/**
 * Returns the group box grown so it also contains the given boxes of members.
 * Returns the given box if it already contains them.
 */
export function growGroupBox(box: Box, memberBoxes: Box[]): Box {
  const around = groupBoxAroundBoxes(memberBoxes);
  if (!around || containsBox(box, around)) return box;

  return unionBox([box, around])!;
}

/**
 * Returns the smallest size of a group that each of the given members still
 * fits into on its own.
 */
export function minGroupSize(memberBoxes: Box[]): Size {
  const sizes = memberBoxes.map(box => groupBoxAroundBoxes([box])!);

  return {
    width: Math.max(0, ...sizes.map(size => size.width)),
    height: Math.max(0, ...sizes.map(size => size.height)),
  };
}

/**
 * Returns the area of a group box that its members are kept in, with the same
 * space to the edges as a group placed around them.
 */
export function groupInnerBox(box: Box): Box {
  return {
    x: box.x + GROUP_PADDING,
    y: box.y + GROUP_PADDING + GROUP_LABEL_HEIGHT / 2,
    width: box.width - GROUP_PADDING * 2,
    height: box.height - GROUP_PADDING * 2 - GROUP_LABEL_HEIGHT / 2,
  };
}

// Boxes that only touch count as overlapping, so lines along an edge overlap it
export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

export function boxCenter(box: Box): Position {
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

// Groups are nested by parentId, older files use groupId for it
export function groupParentId(annotation: GroupStyleAnnotation): string | null {
  return annotation.parentId ?? annotation.groupId ?? null;
}

/**
 * Returns the distance by which the inner box has to move to be inside the
 * outer box. Boxes that are too large are aligned with the top left corner.
 */
export function shiftIntoBox(outer: Box, inner: Box): Position {
  const shift = (
    start: number,
    size: number,
    outerStart: number,
    outerSize: number,
  ) => {
    if (start < outerStart || size > outerSize) return outerStart - start;

    return Math.min(0, outerStart + outerSize - (start + size));
  };

  return {
    x: shift(inner.x, inner.width, outer.x, outer.width),
    y: shift(inner.y, inner.height, outer.y, outer.height),
  };
}

/**
 * Returns the position closest to the given one at which a node fits into the
 * group box, with the same space to the edges as a group placed around it.
 */
export function fitIntoGroupBox(box: Box, position: Position): Position {
  const left = box.x + GROUP_PADDING + NODE_SIZE / 2;
  const right = box.x + box.width - GROUP_PADDING - NODE_SIZE / 2;
  const top = box.y + GROUP_PADDING + GROUP_LABEL_HEIGHT / 2 + NODE_SIZE / 2;
  const bottom =
    box.y + box.height - GROUP_PADDING - NODE_SIZE / 2 - NODE_LABEL_HEIGHT;

  const clamp = (value: number, min: number, max: number) =>
    min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value));

  return {
    x: roundCoordinate(clamp(position.x, left, right)),
    y: roundCoordinate(clamp(position.y, top, bottom)),
  };
}

export function containsPoint(box: Box, point: Position): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

export function containsBox(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Returns the box spanned by two corners in any order.
 */
export function boxBetween(a: Position, b: Position): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Returns the ID of the group a node belongs to. Legacy annotations reference
 * the group by its name or ID in the group field instead.
 */
export function nodeGroupId(
  membership: GroupMembership | undefined,
  groups: GroupStyleAnnotation[],
): string | null {
  if (!membership) return null;
  if (membership.groupId) return membership.groupId;
  if (!membership.group) return null;

  const group =
    groups.find(group => group.id === membership.group) ??
    groups.find(group => group.name === membership.group);

  return group?.id ?? legacyGroupId(membership.group, membership.level);
}

export function legacyGroupId(group: string, level?: string): string {
  return level !== undefined ? `${group}:${level}` : group;
}

/**
 * Returns the groups of a topology as they are shown in the graph, in the order
 * they are drawn. Nested groups are drawn after the group they are in.
 *
 * @param groupAnnotations The group annotations of the topology.
 * @param nodes The nodes of the graph.
 * @param shapes The shape annotations of the topology.
 * @param texts The text annotations of the topology.
 */
export function readGraphGroups(
  groupAnnotations: GroupStyleAnnotation[],
  nodes: GroupMember[],
  shapes: FreeShapeAnnotation[] = [],
  texts: FreeTextAnnotation[] = [],
): GraphGroup[] {
  const members = new Map<string, string[]>();
  const legacyGroups = new Map<string, GroupMember>();
  const nodePositions = new Map(nodes.map(node => [node.name, node.position]));

  for (const node of nodes) {
    const groupId = nodeGroupId(node, groupAnnotations);
    if (groupId === null) continue;

    members.set(groupId, [...(members.get(groupId) ?? []), node.name]);

    if (!groupAnnotations.some(group => group.id === groupId)) {
      legacyGroups.set(groupId, node);
    }
  }

  const parentIds = groupParentIds(groupAnnotations);
  const shapeIds = idsByGroup(shapes, parentIds);
  const textIds = idsByGroup(texts, parentIds);
  const childIds = new Map<string, string[]>();

  for (const [groupId, parentId] of parentIds) {
    if (parentId !== null) {
      childIds.set(parentId, [...(childIds.get(parentId) ?? []), groupId]);
    }
  }

  const groups: GraphGroup[] = groupAnnotations.map(annotation => ({
    id: annotation.id,
    name: annotation.name,
    x: annotation.position.x,
    y: annotation.position.y,
    width: annotation.width,
    height: annotation.height,
    memberIds: members.get(annotation.id) ?? [],
    shapeIds: shapeIds.get(annotation.id) ?? [],
    textIds: textIds.get(annotation.id) ?? [],
    groupIds: childIds.get(annotation.id) ?? [],
    parentId: parentIds.get(annotation.id) ?? null,
    annotation,
  }));

  for (const [groupId, member] of legacyGroups) {
    const memberIds = members.get(groupId)!;
    const box = groupBoxAround(
      memberIds.map(nodeName => nodePositions.get(nodeName)!),
    );
    if (!box) continue;

    groups.push({
      ...box,
      id: groupId,
      name: member.group!,
      memberIds,
      shapeIds: [],
      textIds: [],
      groupIds: [],
      parentId: null,
      annotation: null,
    });
  }

  return treeOrder(groups, group => ({
    id: group.id,
    parentId: group.parentId,
    zIndex: layerZIndex({kind: 'group', id: group.id, group}),
  }));
}

/**
 * Returns the parent of each group by its ID. Parents that don't exist or would
 * nest a group in itself are ignored.
 */
function groupParentIds(
  groupAnnotations: GroupStyleAnnotation[],
): Map<string, string | null> {
  const declared = new Map(
    groupAnnotations.map(annotation => [
      annotation.id,
      groupParentId(annotation),
    ]),
  );

  const parentIds = new Map<string, string | null>();
  for (const groupId of declared.keys()) {
    const parentId = declared.get(groupId) ?? null;
    let ancestorId = parentId;
    const visited = new Set([groupId]);

    while (ancestorId !== null && declared.has(ancestorId)) {
      if (visited.has(ancestorId)) break;
      visited.add(ancestorId);
      ancestorId = declared.get(ancestorId) ?? null;
    }

    const isValid =
      parentId !== null && declared.has(parentId) && ancestorId === null;
    parentIds.set(groupId, isValid ? parentId : null);
  }

  return parentIds;
}

// The IDs of the shapes or texts in each group, by group ID
function idsByGroup(
  items: {id: string; groupId?: string}[],
  parentIds: Map<string, string | null>,
): Map<string, string[]> {
  const ids = new Map<string, string[]>();

  for (const item of items) {
    if (item.groupId === undefined || !parentIds.has(item.groupId)) continue;
    ids.set(item.groupId, [...(ids.get(item.groupId) ?? []), item.id]);
  }

  return ids;
}

/**
 * Orders items so each item comes right before its children, siblings are
 * ordered by their z-index.
 */
function treeOrder<T>(
  items: T[],
  node: (item: T) => {id: string; parentId: string | null; zIndex: number},
): T[] {
  const ids = new Set(items.map(item => node(item).id));
  const children = new Map<string | null, T[]>();

  for (const item of items) {
    const parentId = node(item).parentId;
    const key = parentId !== null && ids.has(parentId) ? parentId : null;
    children.set(key, [...(children.get(key) ?? []), item]);
  }

  const ordered: T[] = [];
  const visit = (parentId: string | null) => {
    const siblings = (children.get(parentId) ?? []).toSorted(
      (a, b) => node(a).zIndex - node(b).zIndex,
    );

    for (const item of siblings) {
      ordered.push(item);
      visit(node(item).id);
    }
  };
  visit(null);

  return ordered;
}

/**
 * Returns everything inside a group, including the contents of nested groups.
 */
export function groupContents(
  groups: GraphGroup[],
  groupId: string,
): {
  nodeIds: string[];
  groupIds: string[];
  shapeIds: string[];
  textIds: string[];
} {
  const contents = {
    nodeIds: [] as string[],
    groupIds: [] as string[],
    shapeIds: [] as string[],
    textIds: [] as string[],
  };
  const groupById = new Map(groups.map(group => [group.id, group]));

  const visit = (id: string) => {
    const group = groupById.get(id);
    if (!group) return;

    contents.nodeIds.push(...group.memberIds);
    contents.shapeIds.push(...group.shapeIds);
    contents.textIds.push(...group.textIds);

    for (const childId of group.groupIds) {
      contents.groupIds.push(childId);
      visit(childId);
    }
  };
  visit(groupId);

  return contents;
}

/**
 * Returns the topmost group that contains the given position.
 */
export function groupAt(
  groups: GraphGroup[],
  position: Position,
): GraphGroup | null {
  return groups.findLast(group => containsPoint(group, position)) ?? null;
}

export function groupLabelBox(group: GraphGroup): Box {
  const inset = groupLabelInset(
    group,
    groupStyle(group.annotation).cornerRadius,
  );

  return {
    x: group.x + inset,
    y: group.y + inset,
    width: Math.min(
      group.width,
      group.name.length * GROUP_LABEL_CHAR_WIDTH + GROUP_PADDING,
    ),
    height: GROUP_LABEL_HEIGHT,
  };
}

/**
 * Returns how far the label of a group moves in from its top left corner, so it
 * stays inside the rounded corner of the group.
 */
export function groupLabelInset(box: Box, cornerRadius: number): number {
  const radius = Math.min(cornerRadius, box.width / 2, box.height / 2);

  return Math.max(0, radius * (1 - Math.SQRT1_2));
}

export function moveBox(box: Box, delta: Position): Box {
  return {...box, x: box.x + delta.x, y: box.y + delta.y};
}

export function roundCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

export type LayerHit =
  | {kind: 'group'; group: GraphGroup; part: GroupHitPart}
  | {kind: 'shape'; shape: GraphShape};

/**
 * Returns the topmost group or shape at the given position.
 *
 * @param items The groups and shapes in the order they are drawn.
 * @param position The position in the graph.
 * @param tolerance The distance in the graph at which outlines are still hit.
 */
export function hitTestLayers(
  items: LayerItem[],
  position: Position,
  tolerance: number,
): LayerHit | null {
  return layerHits(items, position, tolerance).next().value ?? null;
}

/**
 * Yields the groups and shapes at the given position from the topmost one down.
 *
 * @param items The groups and shapes in the order they are drawn.
 * @param position The position in the graph.
 * @param tolerance The distance in the graph at which outlines are still hit.
 */
export function* layerHits(
  items: LayerItem[],
  position: Position,
  tolerance: number,
): Generator<LayerHit> {
  for (const item of items.toReversed()) {
    if (item.kind === 'group') {
      if (!containsPoint(item.group, position)) continue;

      yield {
        kind: 'group',
        group: item.group,
        part: containsPoint(groupLabelBox(item.group), position)
          ? GroupHitPart.Label
          : GroupHitPart.Body,
      };
      continue;
    }

    const geometry = shapeGeometry(item.shape.annotation);
    if (isShapeHit(item.shape, geometry, position, tolerance)) {
      yield {kind: 'shape', shape: item.shape};
    }
  }
}

/**
 * Returns the texts in the order they are drawn.
 */
export function readGraphTexts(
  textAnnotations: FreeTextAnnotation[],
): GraphText[] {
  return textAnnotations
    .toSorted((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map(annotation => ({id: annotation.id, annotation}));
}

/**
 * Returns the box of a text, or null if it wasn't rendered yet.
 *
 * @param annotation The annotation of the text.
 * @param size The rendered size of the text.
 */
export function textBox(
  annotation: Pick<FreeTextAnnotation, 'position'>,
  size: Size | undefined,
): Box | null {
  if (!size) return null;

  return {
    x: annotation.position.x,
    y: annotation.position.y,
    width: size.width,
    height: size.height,
  };
}

/**
 * Returns the box of a text from its annotation, for texts that weren't
 * rendered. Texts without a size get the size they are placed with.
 */
export function storedTextBox(annotation: FreeTextAnnotation): Box {
  return {
    ...annotation.position,
    width: annotation.width ?? DEFAULT_TEXT_WIDTH,
    height: annotation.height ?? DEFAULT_TEXT_HEIGHT,
  };
}

/**
 * Returns the topmost text at the given position.
 *
 * @param texts The texts in the order they are drawn.
 * @param sizes The rendered sizes of the texts by ID.
 * @param position The position in the graph.
 */
export function textAt(
  texts: GraphText[],
  sizes: Map<string, Size>,
  position: Position,
): GraphText | null {
  return (
    texts.findLast(text => {
      const box = textBox(text.annotation, sizes.get(text.id));
      return box !== null && containsPoint(box, position);
    }) ?? null
  );
}

/**
 * Returns the boxes of the given groups, shapes and texts.
 *
 * @param items The groups and shapes.
 * @param texts The texts.
 * @param textSizes The rendered sizes of the texts, which are used when given.
 */
export function annotationBoxes(
  items: LayerItem[],
  texts: GraphText[],
  textSizes?: Map<string, Size>,
): Box[] {
  return [
    ...items.map(item =>
      item.kind === 'group'
        ? item.group
        : shapeBox(shapeGeometry(item.shape.annotation)),
    ),
    ...texts.map(
      text =>
        textBox(text.annotation, textSizes?.get(text.id)) ??
        storedTextBox(text.annotation),
    ),
  ];
}

export function readGraphShapes(
  shapeAnnotations: FreeShapeAnnotation[],
): GraphShape[] {
  return shapeAnnotations.map(annotation => ({
    id: annotation.id,
    annotation,
  }));
}

/**
 * Returns the groups and shapes in the order they are drawn. Items with the same
 * z-index keep their order, groups are drawn before shapes.
 */
export function readLayerItems(
  groups: GraphGroup[],
  shapes: GraphShape[],
): LayerItem[] {
  const items: LayerItem[] = [
    ...groups.map(group => ({kind: 'group' as const, id: group.id, group})),
    ...shapes.map(shape => ({kind: 'shape' as const, id: shape.id, shape})),
  ];

  // Shapes in a group are drawn on top of it, like its nested groups
  return treeOrder(items, item => ({
    id: item.id,
    parentId:
      item.kind === 'group'
        ? item.group.parentId
        : (item.shape.annotation.groupId ?? null),
    zIndex: layerZIndex(item),
  }));
}

function layerZIndex(item: LayerItem) {
  if (item.kind === 'shape') return item.shape.annotation.zIndex ?? 0;

  // Legacy groups don't have an annotation and are drawn behind everything
  return item.group.annotation
    ? (item.group.annotation.zIndex ?? 0)
    : Number.MIN_SAFE_INTEGER;
}

/**
 * Returns the position and size of a shape with defaults for missing fields.
 */
export function shapeGeometry(annotation: FreeShapeAnnotation): ShapeGeometry {
  if (annotation.shapeType === 'line') {
    return {
      position: annotation.position,
      endPosition: annotation.endPosition ?? {
        x: annotation.position.x + DEFAULT_LINE_LENGTH,
        y: annotation.position.y,
      },
    };
  }

  return {
    position: annotation.position,
    width: annotation.width ?? DEFAULT_SHAPE_WIDTH,
    height: annotation.height ?? DEFAULT_SHAPE_HEIGHT,
  };
}

/**
 * Returns the geometry of a shape or text that is placed with a click at the
 * given position instead of being drawn.
 */
export function placedGeometry(
  kind: DrawKind,
  position: Position,
): ShapeGeometry {
  if (kind === 'text') {
    return {position, width: DEFAULT_TEXT_WIDTH, height: DEFAULT_TEXT_HEIGHT};
  }

  if (kind === 'group') {
    return {position, width: DEFAULT_GROUP_WIDTH, height: DEFAULT_GROUP_HEIGHT};
  }

  return shapeGeometry({id: '', shapeType: kind, position});
}

export function shapeBox(geometry: ShapeGeometry): Box {
  if (geometry.endPosition) {
    return boxBetween(geometry.position, geometry.endPosition);
  }

  return {
    x: geometry.position.x,
    y: geometry.position.y,
    width: geometry.width ?? 0,
    height: geometry.height ?? 0,
  };
}

export function moveShapeGeometry(
  geometry: ShapeGeometry,
  delta: Position,
): ShapeGeometry {
  const move = (position: Position) => ({
    x: roundCoordinate(position.x + delta.x),
    y: roundCoordinate(position.y + delta.y),
  });

  return {
    ...geometry,
    position: move(geometry.position),
    ...(geometry.endPosition ? {endPosition: move(geometry.endPosition)} : {}),
  };
}

/**
 * Maps positions and boxes of elements that are moved or resized together.
 */
export interface SelectionTransform {
  position: (position: Position) => Position;
  box: (box: Box) => Box;
}

export function translateTransform(delta: Position): SelectionTransform {
  return {
    position: position => ({x: position.x + delta.x, y: position.y + delta.y}),
    box: box => moveBox(box, delta),
  };
}

/**
 * Returns the transform that resizes the given box to the other box, the
 * elements inside it keep their place relative to the box.
 */
export function scaleTransform(from: Box, to: Box): SelectionTransform {
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;

  const position = (position: Position) => ({
    x: to.x + (position.x - from.x) * scaleX,
    y: to.y + (position.y - from.y) * scaleY,
  });

  return {
    position,
    box: box => ({
      ...position(box),
      width: box.width * scaleX,
      height: box.height * scaleY,
    }),
  };
}

export function transformShapeGeometry(
  geometry: ShapeGeometry,
  transform: SelectionTransform,
): ShapeGeometry {
  if (geometry.endPosition) {
    return {
      position: roundPosition(transform.position(geometry.position)),
      endPosition: roundPosition(transform.position(geometry.endPosition)),
    };
  }

  const box = transform.box(shapeBox(geometry));
  return {
    position: roundPosition(box),
    width: roundCoordinate(box.width),
    height: roundCoordinate(box.height),
  };
}

/**
 * Returns the geometry of a shape or text drawn from one corner to another.
 * Shift makes boxes square and lines horizontal or vertical.
 */
export function drawnShapeGeometry(
  kind: DrawKind,
  origin: Position,
  pointer: Position,
  isShift: boolean,
): ShapeGeometry {
  let dx = pointer.x - origin.x;
  let dy = pointer.y - origin.y;

  if (kind === 'line') {
    if (isShift && Math.abs(dx) > Math.abs(dy)) dy = 0;
    else if (isShift) dx = 0;

    return {
      position: roundPosition(origin),
      endPosition: roundPosition({x: origin.x + dx, y: origin.y + dy}),
    };
  }

  if (isShift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }

  const box = boxBetween(origin, {x: origin.x + dx, y: origin.y + dy});
  return {
    position: roundPosition(box),
    width: roundCoordinate(box.width),
    height: roundCoordinate(box.height),
  };
}

/**
 * Returns whether the shape is hit at the given position. Lines and shapes
 * without a fill are only hit close to their outline.
 *
 * @param shape The shape to test.
 * @param geometry The current geometry of the shape.
 * @param position The position in the graph.
 * @param tolerance The distance in the graph at which an outline is still hit.
 */
export function isShapeHit(
  shape: GraphShape,
  geometry: ShapeGeometry,
  position: Position,
  tolerance: number,
): boolean {
  const annotation = shape.annotation;
  const outline = tolerance + (annotation.borderWidth ?? 0) / 2;

  if (geometry.endPosition) {
    return (
      segmentDistance(position, geometry.position, geometry.endPosition) <=
      outline
    );
  }

  const box = shapeBox(geometry);
  const isFilled =
    annotation.fillColor !== 'transparent' && (annotation.fillOpacity ?? 1) > 0;

  if (annotation.shapeType === 'circle') {
    const rx = box.width / 2;
    const ry = box.height / 2;
    const ellipseDistance = (grow: number) =>
      ((position.x - box.x - rx) / Math.max(rx + grow, 1)) ** 2 +
      ((position.y - box.y - ry) / Math.max(ry + grow, 1)) ** 2;

    if (ellipseDistance(outline) > 1) return false;
    return isFilled || ellipseDistance(-outline) >= 1;
  }

  const outer = growBox(box, outline);
  if (!containsPoint(outer, position)) return false;

  return isFilled || !containsPoint(growBox(box, -outline), position);
}

export function growBox(box: Box, distance: number): Box {
  return {
    x: box.x - distance,
    y: box.y - distance,
    width: box.width + distance * 2,
    height: box.height + distance * 2,
  };
}

function segmentDistance(point: Position, a: Position, b: Position) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
          ),
        );

  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

export function roundPosition(position: Position): Position {
  return {x: roundCoordinate(position.x), y: roundCoordinate(position.y)};
}
