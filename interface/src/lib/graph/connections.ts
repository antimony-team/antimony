import {
  Box,
  roundPosition,
  ShapeGeometry,
} from '@sb/lib/graph/annotation-geometry';
import {Position} from '@sb/types/types';

/*
 * Line ends this close to a connection point lie on it. The stored positions
 * are rounded and the height of a text is measured, so they can be off a bit.
 */
const ATTACHED_DISTANCE = 0.05;

export type ConnectionSide = 'n' | 'e' | 's' | 'w';
type LineEnd = 'start' | 'end';

export const CONNECTION_SIDES: ConnectionSide[] = ['n', 'e', 's', 'w'];

// Distance on screen from the side of a hovered element to the middle of its arrow, and the arrow's reach
export const CONNECTION_ARROW_OFFSET = 30;
export const CONNECTION_ARROW_RADIUS = 18;

/**
 * A group, shape or text that lines connect to, by its element key.
 */
export interface Connectable {
  key: string;
  box: Box;

  // The colors of its fill and border, its connection points are drawn in them
  fill: string;
  stroke: string;
}

/**
 * The end of a line that lies on a connection point of an element, it follows
 * the element when the element moves or is resized. Connections aren't saved,
 * they are found again from the positions whenever they are needed.
 */
export interface LineAttachment {
  lineId: string;
  end: LineEnd;
  key: string;
  side: ConnectionSide;

  // The box of the element and the geometry of the line when the attachment was found
  box: Box;
  geometry: ShapeGeometry;
}

/**
 * The point in the middle of the given side of a box.
 */
export function connectionPoint(box: Box, side: ConnectionSide): Position {
  switch (side) {
    case 'n':
      return {x: box.x + box.width / 2, y: box.y};
    case 'e':
      return {x: box.x + box.width, y: box.y + box.height / 2};
    case 's':
      return {x: box.x + box.width / 2, y: box.y + box.height};
    case 'w':
      return {x: box.x, y: box.y + box.height / 2};
  }
}

// The direction the side of a box faces
export function sideNormal(side: ConnectionSide): Position {
  switch (side) {
    case 'n':
      return {x: 0, y: -1};
    case 'e':
      return {x: 1, y: 0};
    case 's':
      return {x: 0, y: 1};
    case 'w':
      return {x: -1, y: 0};
  }
}

/**
 * The middle of the arrow outside the given side of a hovered element, a line
 * is drawn from that side when the arrow is pressed.
 */
export function connectionArrow(
  box: Box,
  side: ConnectionSide,
  zoom: number,
): Position {
  const point = connectionPoint(box, side);
  const normal = sideNormal(side);
  const offset = CONNECTION_ARROW_OFFSET / zoom;

  return {x: point.x + normal.x * offset, y: point.y + normal.y * offset};
}

// The side whose arrow is at the position, or null
export function connectionArrowAt(
  box: Box,
  position: Position,
  zoom: number,
): ConnectionSide | null {
  return (
    CONNECTION_SIDES.find(side => {
      const arrow = connectionArrow(box, side, zoom);
      return (
        Math.hypot(arrow.x - position.x, arrow.y - position.y) <=
        CONNECTION_ARROW_RADIUS / zoom
      );
    }) ?? null
  );
}

/**
 * Returns the ends of the given lines that lie on a connection point of one of
 * the given elements. The points are looked up by their rounded position, so
 * it takes a single pass over the lines and the elements.
 */
export function lineAttachments(
  lines: {id: string; geometry: ShapeGeometry}[],
  elements: Connectable[],
): LineAttachment[] {
  const points = new Map<
    string,
    {element: Connectable; side: ConnectionSide}[]
  >();

  for (const element of elements) {
    for (const side of CONNECTION_SIDES) {
      const [x, y] = cellOf(connectionPoint(element.box, side));
      const key = `${x}:${y}`;
      if (!points.has(key)) points.set(key, []);
      points.get(key)!.push({element, side});
    }
  }

  const attachments: LineAttachment[] = [];
  for (const line of lines) {
    for (const [end, position] of lineEnds(line.geometry)) {
      const point = cellsAround(position)
        .flatMap(key => points.get(key) ?? [])
        .find(({element, side}) =>
          isAt(connectionPoint(element.box, side), position),
        );
      if (!point) continue;

      attachments.push({
        lineId: line.id,
        end,
        key: point.element.key,
        side: point.side,
        box: point.element.box,
        geometry: line.geometry,
      });
    }
  }

  return attachments;
}

/**
 * Moves the attached ends of the lines to the elements' new boxes. Returns the
 * new geometry of each line whose element changed, the box function returns
 * undefined for the elements that didn't.
 */
export function followLines(
  attachments: LineAttachment[],
  boxOf: (attachment: LineAttachment) => Box | undefined,
): Map<string, ShapeGeometry> {
  const lines = new Map<string, ShapeGeometry>();

  for (const attachment of attachments) {
    const box = boxOf(attachment);
    if (!box) continue;

    const geometry = lines.get(attachment.lineId) ?? attachment.geometry;
    const point = roundPosition(connectionPoint(box, attachment.side));

    lines.set(
      attachment.lineId,
      attachment.end === 'start'
        ? {...geometry, position: point}
        : {...geometry, endPosition: point},
    );
  }

  return lines;
}

// A connection point with the key of its element and its side
export interface Connection {
  key: string;
  side: ConnectionSide;
  position: Position;
}

/**
 * Returns the connection point closest to the position within the distance.
 */
export function closestConnection(
  position: Position,
  elements: Connectable[],
  distance: number,
): Connection | null {
  let closest: Connection | null = null;
  let closestDistance = distance;

  for (const element of elements) {
    for (const side of CONNECTION_SIDES) {
      const point = connectionPoint(element.box, side);
      const pointDistance = Math.hypot(
        point.x - position.x,
        point.y - position.y,
      );

      if (pointDistance <= closestDistance) {
        closest = {key: element.key, side, position: point};
        closestDistance = pointDistance;
      }
    }
  }

  return closest;
}

function lineEnds(geometry: ShapeGeometry): [LineEnd, Position][] {
  return [
    ['start', geometry.position],
    ['end', geometry.endPosition ?? geometry.position],
  ];
}

function isAt(a: Position, b: Position): boolean {
  return (
    Math.abs(a.x - b.x) <= ATTACHED_DISTANCE &&
    Math.abs(a.y - b.y) <= ATTACHED_DISTANCE
  );
}

// Points within the distance of each other are in the same or a neighbouring cell
function cellOf(position: Position): [number, number] {
  return [
    Math.round(position.x / ATTACHED_DISTANCE),
    Math.round(position.y / ATTACHED_DISTANCE),
  ];
}

function cellsAround(position: Position): string[] {
  const [x, y] = cellOf(position);
  return [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => `${x + dx}:${y + dy}`));
}
