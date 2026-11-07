import {describe, expect, it} from 'vitest';

import {
  closestConnection,
  Connectable,
  connectionArrow,
  connectionArrowAt,
  connectionPoint,
  followLines,
  lineAttachments,
  sideNormal,
} from '@sb/lib/graph/connections';

const box = {x: 0, y: 0, width: 100, height: 50};

function connectable(key: string, fields = box): Connectable {
  return {key, box: fields, fill: '#000', stroke: '#fff'};
}

describe('connectionPoint', () => {
  it('returns the middle of each side', () => {
    expect(connectionPoint(box, 'n')).toEqual({x: 50, y: 0});
    expect(connectionPoint(box, 'e')).toEqual({x: 100, y: 25});
    expect(connectionPoint(box, 's')).toEqual({x: 50, y: 50});
    expect(connectionPoint(box, 'w')).toEqual({x: 0, y: 25});
  });

  it('points each side outwards', () => {
    expect(sideNormal('n')).toEqual({x: 0, y: -1});
    expect(sideNormal('e')).toEqual({x: 1, y: 0});
    expect(sideNormal('s')).toEqual({x: 0, y: 1});
    expect(sideNormal('w')).toEqual({x: -1, y: 0});
  });
});

describe('connection arrows', () => {
  it('places the arrow outside the side at the same distance on screen', () => {
    expect(connectionArrow(box, 'e', 1)).toEqual({x: 130, y: 25});
    expect(connectionArrow(box, 'n', 2)).toEqual({x: 50, y: -15});
  });

  it('finds the side whose arrow is at a position', () => {
    expect(connectionArrowAt(box, {x: 130, y: 25}, 1)).toBe('e');
    expect(connectionArrowAt(box, {x: -40, y: 25}, 1)).toBe('w');
    expect(connectionArrowAt(box, {x: 50, y: 25}, 1)).toBeNull();
  });

  it('shrinks the reach of the arrows when zoomed in', () => {
    expect(connectionArrowAt(box, {x: 50, y: 92}, 1)).toBe('s');
    expect(connectionArrowAt(box, {x: 50, y: 92}, 4)).toBeNull();
  });
});

describe('lineAttachments', () => {
  it('finds the ends of lines on the connection points of elements', () => {
    const geometry = {position: {x: 100, y: 25}, endPosition: {x: 300, y: 0}};
    const attachments = lineAttachments(
      [{id: 'line', geometry}],
      [
        connectable('a'),
        connectable('b', {x: 250, y: 0, width: 100, height: 50}),
      ],
    );

    expect(attachments).toEqual([
      {lineId: 'line', end: 'start', key: 'a', side: 'e', box, geometry},
      {
        lineId: 'line',
        end: 'end',
        key: 'b',
        side: 'n',
        box: {x: 250, y: 0, width: 100, height: 50},
        geometry,
      },
    ]);
  });

  it('attaches ends that are off by a rounding error', () => {
    const attachments = lineAttachments(
      [
        {
          id: 'line',
          geometry: {
            position: {x: 100.04, y: 24.96},
            endPosition: {x: 0, y: 0},
          },
        },
      ],
      [connectable('a')],
    );
    expect(attachments.map(attachment => attachment.side)).toEqual(['e']);
  });

  it('does not attach ends that are further away', () => {
    const attachments = lineAttachments(
      [
        {
          id: 'line',
          geometry: {position: {x: 100.1, y: 25}, endPosition: {x: 0, y: 0}},
        },
      ],
      [connectable('a')],
    );
    expect(attachments).toEqual([]);
  });

  it('uses the start of geometries without an end for both ends', () => {
    const attachments = lineAttachments(
      [{id: 'line', geometry: {position: {x: 50, y: 0}}}],
      [connectable('a')],
    );
    expect(attachments.map(attachment => attachment.end)).toEqual([
      'start',
      'end',
    ]);
  });
});

describe('followLines', () => {
  const geometry = {position: {x: 100, y: 25}, endPosition: {x: 50, y: 50}};
  const attachments = lineAttachments(
    [{id: 'line', geometry}],
    [connectable('a')],
  );

  it('moves both attached ends of a line to the new box', () => {
    const moved = {x: 10.123, y: 10, width: 100, height: 50};
    expect(followLines(attachments, () => moved)).toEqual(
      new Map([
        [
          'line',
          {position: {x: 110.12, y: 35}, endPosition: {x: 60.12, y: 60}},
        ],
      ]),
    );
  });

  it('leaves out lines whose elements did not change', () => {
    expect(followLines(attachments, () => undefined).size).toBe(0);
  });
});

describe('closestConnection', () => {
  it('returns the closest connection point within the distance', () => {
    expect(
      closestConnection(
        {x: 103, y: 25},
        [
          connectable('a'),
          connectable('b', {x: 104, y: 0, width: 100, height: 50}),
        ],
        10,
      ),
    ).toEqual({key: 'b', side: 'w', position: {x: 104, y: 25}});
  });

  it('returns null when no connection point is close enough', () => {
    expect(closestConnection({x: 120, y: 25}, [connectable('a')], 10)).toBe(
      null,
    );
  });

  it('includes points exactly at the distance', () => {
    expect(
      closestConnection({x: 110, y: 25}, [connectable('a')], 10)?.side,
    ).toBe('e');
  });
});
