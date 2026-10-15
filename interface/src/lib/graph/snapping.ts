import {Box} from '@sb/lib/graph/annotation-geometry';
import {GRID_SPACING} from '@sb/lib/graph/placement';
import {Position} from '@sb/types/types';

// Distance on screen within which an edge or a center snaps to another element
export const SNAP_DISTANCE = 6;

// The fine grid that elements snap to when no other element is close
const SNAP_GRID_SPACING = GRID_SPACING / 5;

// Values closer than this are aligned, it hides rounding errors of the snapped boxes
const ALIGNED_DISTANCE = 0.01;

const ALL_SIDES: Side[] = ['start', 'center', 'end'];

// A point has a single line on each axis, it snaps to the edges and to the centers of other elements
const POINT_SIDES: Side[] = ['start', 'center'];

export type SnapAxis = 'x' | 'y';
export type SnapKind = 'edge' | 'center' | 'gap';
export type Side = 'start' | 'center' | 'end';

/**
 * A guide of a moved, resized or drawn box. An edge or a center is a line
 * across the axis at the given value, from the box to the furthest element on
 * the line, so on the x axis it is vertical. A gap is a line along the axis
 * from `from` to `to` at the given value of the other axis, it marks one of the
 * equal gaps between neighbouring elements.
 */
export interface SnapGuide {
  axis: SnapAxis;
  kind: SnapKind;
  value: number;
  from: number;
  to: number;
}

interface SnapLine {
  side: Side;
  value: number;
  box: Box;
}

/**
 * The edges and centers of the elements that stay in place, collected once
 * when the elements start to move, to be resized or to be drawn.
 */
export interface SnapTargets {
  x: SnapLine[];
  y: SnapLine[];

  // The boxes that a moved box keeps equal gaps to, the elements next to it in the same group
  spaced: Box[];
}

export function snapTargets(
  boxes: Box[],
  spacedBoxes: Box[] = [],
): SnapTargets {
  return {
    x: boxes.flatMap(box => boxLines(box, 'x')),
    y: boxes.flatMap(box => boxLines(box, 'y')),
    spaced: spacedBoxes,
  };
}

/**
 * Returns the offset that lines up an edge or the center of the moved box with
 * the closest edge or center of another element on each axis, or that makes
 * its gaps to the elements next to it equal. Without an element close by, the
 * given side of the box goes onto the grid.
 */
export function snapMove(
  box: Box,
  targets: SnapTargets,
  distance: number,
  gridSide: Side = 'start',
): {offset: Position; guides: SnapGuide[]} {
  const offset = {
    x: snapOffset(box, targets, 'x', ALL_SIDES, gridSide, distance),
    y: snapOffset(box, targets, 'y', ALL_SIDES, gridSide, distance),
  };
  const snapped = {...box, x: box.x + offset.x, y: box.y + offset.y};

  return {
    offset,
    guides: [
      ...snapGuides(snapped, targets.x, 'x', ALL_SIDES),
      ...snapGuides(snapped, targets.y, 'y', ALL_SIDES),
      ...gapGuides(snapped, targets.spaced, 'x'),
      ...gapGuides(snapped, targets.spaced, 'y'),
    ],
  };
}

/**
 * Snaps the edges of a resized box that move in the given direction, -1 for
 * the left or top edge and 1 for the right or bottom edge. A box resized from
 * its center moves the opposite edge by the same distance.
 */
export function snapResize(
  box: Box,
  direction: [number, number],
  isCentered: boolean,
  targets: SnapTargets,
  distance: number,
): {box: Box; guides: SnapGuide[]} {
  const snapped = {...box};
  const guides: SnapGuide[] = [];

  for (const axis of ['x', 'y'] as const) {
    const sign = direction[axis === 'x' ? 0 : 1];
    if (sign === 0) continue;

    const side = sign < 0 ? 'start' : 'end';
    const sizeKey = axis === 'x' ? 'width' : 'height';
    const offset = snapOffset(box, targets, axis, [side], side, distance);

    // The start edge moves the box and shrinks it, the end edge grows it
    const growth = (sign < 0 ? -offset : offset) * (isCentered ? 2 : 1);
    if (box[sizeKey] + growth < 1) continue;

    snapped[sizeKey] = box[sizeKey] + growth;
    if (sign < 0 || isCentered) {
      snapped[axis] = box[axis] - (isCentered ? growth / 2 : growth);
    }

    guides.push(...snapGuides(snapped, targets[axis], axis, [side]));
  }

  return {box: snapped, guides};
}

/**
 * Snaps a point, e.g. a corner of a drawn shape, to the edges and centers of
 * other elements, or else onto the grid.
 */
export function snapPoint(
  position: Position,
  targets: SnapTargets,
  distance: number,
): {position: Position; guides: SnapGuide[]} {
  const box = {...position, width: 0, height: 0};
  const snapped = {
    ...box,
    x: box.x + snapOffset(box, targets, 'x', POINT_SIDES, 'start', distance),
    y: box.y + snapOffset(box, targets, 'y', POINT_SIDES, 'start', distance),
  };

  return {
    position: {x: snapped.x, y: snapped.y},
    guides: [
      ...snapGuides(snapped, targets.x, 'x', POINT_SIDES),
      ...snapGuides(snapped, targets.y, 'y', POINT_SIDES),
    ],
  };
}

/*
 * The offset to the closest line or equal gap within the distance, only moved
 * boxes have targets to keep gaps to. Without one,
 * the grid side of the box goes onto the grid, unless that puts it close to an
 * element, where it snaps to the element instead of ending up just next to it.
 */
function snapOffset(
  box: Box,
  targets: SnapTargets,
  axis: SnapAxis,
  sides: Side[],
  gridSide: Side,
  distance: number,
): number {
  const offset = closest([
    closestOffset(box, targets[axis], axis, sides, distance),
    gapOffset(box, targets.spaced, axis, distance),
  ]);
  if (offset !== null) return offset;

  const anchor = boxLines(box, axis).find(line => line.side === gridSide)!;
  const gridOffset =
    Math.round(anchor.value / SNAP_GRID_SPACING) * SNAP_GRID_SPACING -
    anchor.value;
  const onGrid = {...box, [axis]: box[axis] + gridOffset};

  return (
    gridOffset +
    (closestOffset(onGrid, targets[axis], axis, sides, distance) ?? 0)
  );
}

// The offset to the closest line of another element within the distance
function closestOffset(
  box: Box,
  lines: SnapLine[],
  axis: SnapAxis,
  sides: Side[],
  distance: number,
): number | null {
  let offset: number | null = null;

  for (const anchor of boxLines(box, axis)) {
    if (!sides.includes(anchor.side)) continue;

    for (const line of lines) {
      if (kindOf(line.side) !== kindOf(anchor.side)) continue;

      const difference = line.value - anchor.value;
      if (Math.abs(difference) <= distance) {
        offset = closest([offset, difference]);
      }
    }
  }

  return offset;
}

/*
 * The offset within the distance that puts the box in the middle between the
 * elements before and after it, or that repeats a gap between two elements of
 * its row next to it.
 */
function gapOffset(
  box: Box,
  boxes: Box[],
  axis: SnapAxis,
  distance: number,
): number | null {
  const row = rowOf(box, boxes, axis);
  if (row.length === 0) return null;

  const [start, end] = span(box, axis);
  const size = end - start;
  const center = (start + end) / 2;
  const before = maxBy(
    row.filter(other => centerOf(other, axis) < center),
    other => span(other, axis)[1],
  );
  const after = maxBy(
    row.filter(other => centerOf(other, axis) > center),
    other => -span(other, axis)[0],
  );
  const beforeEnd = before ? span(before, axis)[1] : null;
  const afterStart = after ? span(after, axis)[0] : null;

  const starts: number[] = [];
  if (beforeEnd !== null && afterStart !== null) {
    starts.push((beforeEnd + afterStart - size) / 2);
  }
  for (const {gap} of rowGaps(row, axis)) {
    if (beforeEnd !== null) starts.push(beforeEnd + gap);
    if (afterStart !== null) starts.push(afterStart - gap - size);
  }

  return closest(
    starts
      .filter(
        snappedStart =>
          (beforeEnd === null || snappedStart > beforeEnd) &&
          (afterStart === null || snappedStart + size < afterStart),
      )
      .map(snappedStart => snappedStart - start)
      .filter(offset => Math.abs(offset) <= distance),
  );
}

function snapGuides(
  box: Box,
  lines: SnapLine[],
  axis: SnapAxis,
  sides: Side[],
): SnapGuide[] {
  const guides = new Map<string, SnapGuide>();
  const across = otherAxis(axis);

  for (const anchor of boxLines(box, axis)) {
    if (!sides.includes(anchor.side)) continue;

    for (const line of lines) {
      const kind = kindOf(line.side);
      if (
        kind !== kindOf(anchor.side) ||
        Math.abs(line.value - anchor.value) > ALIGNED_DISTANCE
      ) {
        continue;
      }

      const key = `${kind}:${anchor.side}`;
      const [lineFrom, lineTo] = span(line.box, across);
      const guide = guides.get(key) ?? {
        axis,
        kind,
        value: anchor.value,
        from: span(box, across)[0],
        to: span(box, across)[1],
      };

      guides.set(key, {
        ...guide,
        from: Math.min(guide.from, lineFrom),
        to: Math.max(guide.to, lineTo),
      });
    }
  }

  return [...guides.values()];
}

/*
 * Marks the gaps of the box to the elements before and after it if they are
 * equal to each other or to gaps between other elements of its row.
 */
function gapGuides(box: Box, boxes: Box[], axis: SnapAxis): SnapGuide[] {
  const row = rowOf(box, boxes, axis);
  const [start, end] = span(box, axis);
  const before = maxBy(
    row.filter(other => span(other, axis)[1] <= start + ALIGNED_DISTANCE),
    other => span(other, axis)[1],
  );
  const after = maxBy(
    row.filter(other => span(other, axis)[0] >= end - ALIGNED_DISTANCE),
    other => -span(other, axis)[0],
  );

  const gaps = rowGaps(row, axis);
  const boxGaps = [
    ...(before
      ? [{from: before, to: box, gap: start - span(before, axis)[1]}]
      : []),
    ...(after ? [{from: box, to: after, gap: span(after, axis)[0] - end}] : []),
  ].filter(({gap}) => gap > ALIGNED_DISTANCE);

  const pairs = new Map<string, {from: Box; to: Box}>();
  const addGap = (from: Box, to: Box) =>
    pairs.set(`${span(from, axis)[1]}:${span(to, axis)[0]}`, {from, to});

  for (const boxGap of boxGaps) {
    const equal = [
      ...boxGaps.filter(other => other !== boxGap),
      ...gaps,
    ].filter(other => Math.abs(other.gap - boxGap.gap) <= ALIGNED_DISTANCE);
    if (equal.length === 0) continue;

    addGap(boxGap.from, boxGap.to);
    for (const other of equal) addGap(other.from, other.to);
  }

  /*
   * The gaps are marked in line where all of the elements that stay in place
   * overlap, otherwise where each pair does, on the side of that part that the
   * moved box leans to. The marks don't move with the box.
   */
  const across = otherAxis(axis);
  const fixed = (boxes: Box[]) => boxes.filter(other => other !== box);
  const shared = overlapOf(
    fixed([...pairs.values()].flatMap(({from, to}) => [from, to])),
    across,
  );

  return [...pairs.values()].map(({from, to}) => {
    const [start, end] =
      shared ??
      overlapOf(fixed([from, to]), across) ??
      overlapOf([from, to], across)!;

    return {
      axis,
      kind: 'gap' as const,
      value: centerOf(box, across) < (start + end) / 2 ? start : end,
      from: span(from, axis)[1],
      to: span(to, axis)[0],
    };
  });
}

// The part of the axis that all boxes cover, or null if they don't all overlap
function overlapOf(boxes: Box[], axis: SnapAxis): [number, number] | null {
  if (boxes.length === 0) return null;

  const start = Math.max(...boxes.map(box => span(box, axis)[0]));
  const end = Math.min(...boxes.map(box => span(box, axis)[1]));

  return end > start ? [start, end] : null;
}

// The boxes that overlap the given box on the other axis, so they are next to it on the axis
function rowOf(box: Box, boxes: Box[], axis: SnapAxis): Box[] {
  const across = otherAxis(axis);
  const [start, end] = span(box, across);

  return boxes.filter(other => {
    const [otherStart, otherEnd] = span(other, across);
    return otherStart < end && start < otherEnd;
  });
}

/*
 * The gaps between neighbouring boxes of a row that nothing else of the row
 * overlaps, from the box that reaches furthest to the box after the gap.
 */
function rowGaps(
  row: Box[],
  axis: SnapAxis,
): {from: Box; to: Box; gap: number}[] {
  const sorted = [...row].sort((a, b) => span(a, axis)[0] - span(b, axis)[0]);
  const gaps: {from: Box; to: Box; gap: number}[] = [];

  let furthest: Box | null = null;
  for (const box of sorted) {
    const [start, end] = span(box, axis);

    if (furthest) {
      const gap = start - span(furthest, axis)[1];
      if (gap > ALIGNED_DISTANCE) gaps.push({from: furthest, to: box, gap});
    }
    if (!furthest || end > span(furthest, axis)[1]) furthest = box;
  }

  return gaps;
}

function boxLines(box: Box, axis: SnapAxis): SnapLine[] {
  const [start, end] = span(box, axis);

  return [
    {side: 'start', value: start, box},
    {side: 'center', value: (start + end) / 2, box},
    {side: 'end', value: end, box},
  ];
}

function span(box: Box, axis: SnapAxis): [number, number] {
  return axis === 'x'
    ? [box.x, box.x + box.width]
    : [box.y, box.y + box.height];
}

function centerOf(box: Box, axis: SnapAxis): number {
  const [start, end] = span(box, axis);
  return (start + end) / 2;
}

function otherAxis(axis: SnapAxis): SnapAxis {
  return axis === 'x' ? 'y' : 'x';
}

function kindOf(side: Side): SnapKind {
  return side === 'center' ? 'center' : 'edge';
}

// The offset closest to zero
function closest(offsets: (number | null)[]): number | null {
  let result: number | null = null;

  for (const offset of offsets) {
    if (
      offset !== null &&
      (result === null || Math.abs(offset) < Math.abs(result))
    ) {
      result = offset;
    }
  }

  return result;
}

function maxBy<T>(items: T[], value: (item: T) => number): T | null {
  let result: T | null = null;

  for (const item of items) {
    if (result === null || value(item) > value(result)) result = item;
  }

  return result;
}
