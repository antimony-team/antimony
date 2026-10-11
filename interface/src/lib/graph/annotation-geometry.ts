import {GroupStyleAnnotation, NodeAnnotation} from '@sb/types/domain/topology';
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
  memberIds: string[];

  // Null for legacy groups that don't have an annotation yet
  annotation: GroupStyleAnnotation | null;
}

// Size of a topology node in the graph, see cytoscape-styles.ts
const NODE_SIZE = 64;
const NODE_LABEL_HEIGHT = 20;

const GROUP_PADDING = 24;

// The label sits in the top left corner of a group
const GROUP_LABEL_HEIGHT = 28;
const GROUP_LABEL_CHAR_WIDTH = 7.5;

export enum GroupHitPart {
  Label,
  Body,
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
  const box = unionBox(positions.map(nodeBox));
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
 * Returns the group box grown so it also contains the nodes at the given
 * positions. Returns the given box if it already contains them.
 */
export function growGroupBox(box: Box, positions: Position[]): Box {
  const around = groupBoxAround(positions);
  if (!around || containsBox(box, around)) return box;

  return unionBox([box, around])!;
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
 * they are drawn.
 *
 * @param groupAnnotations The group annotations of the topology.
 * @param nodes The nodes of the graph.
 */
export function readGraphGroups(
  groupAnnotations: GroupStyleAnnotation[],
  nodes: GroupMember[],
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

  const groups: GraphGroup[] = groupAnnotations
    .toSorted((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map(annotation => ({
      id: annotation.id,
      name: annotation.name,
      x: annotation.position.x,
      y: annotation.position.y,
      width: annotation.width,
      height: annotation.height,
      memberIds: members.get(annotation.id) ?? [],
      annotation,
    }));

  for (const [groupId, member] of legacyGroups) {
    const memberIds = members.get(groupId)!;
    const box = groupBoxAround(
      memberIds.map(nodeName => nodePositions.get(nodeName)!),
    );
    if (!box) continue;

    groups.unshift({
      ...box,
      id: groupId,
      name: member.group!,
      memberIds,
      annotation: null,
    });
  }

  return groups;
}

/**
 * Returns the topmost group at the given position and whether its label was hit.
 *
 * @param groups The groups in the order they are drawn.
 * @param position The position in the graph.
 */
export function hitTestGroups(
  groups: GraphGroup[],
  position: Position,
): {group: GraphGroup; part: GroupHitPart} | null {
  const group = groupAt(groups, position);
  if (!group) return null;

  return {
    group,
    part: containsPoint(groupLabelBox(group), position)
      ? GroupHitPart.Label
      : GroupHitPart.Body,
  };
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
  return {
    x: group.x,
    y: group.y,
    width: Math.min(
      group.width,
      group.name.length * GROUP_LABEL_CHAR_WIDTH + GROUP_PADDING,
    ),
    height: GROUP_LABEL_HEIGHT,
  };
}

export function moveBox(box: Box, delta: Position): Box {
  return {...box, x: box.x + delta.x, y: box.y + delta.y};
}

export function roundCoordinate(value: number): number {
  return Number(value.toFixed(2));
}
