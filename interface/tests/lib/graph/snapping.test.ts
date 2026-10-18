import {describe, expect, it} from 'vitest';

import {
  snapMove,
  snapPoint,
  snapResize,
  snapTargets,
} from '@sb/lib/graph/snapping';

const DISTANCE = 6;

describe('snapTargets', () => {
  it('collects the start, center and end of each box on both axes', () => {
    const box = {x: 0, y: 10, width: 100, height: 20};
    const targets = snapTargets([box]);

    expect(targets.x.map(line => [line.side, line.value])).toEqual([
      ['start', 0],
      ['center', 50],
      ['end', 100],
    ]);
    expect(targets.y.map(line => [line.side, line.value])).toEqual([
      ['start', 10],
      ['center', 20],
      ['end', 30],
    ]);
    expect(targets.spaced).toEqual([]);
  });
});

describe('snapMove', () => {
  it('puts the start of the box onto the grid without elements nearby', () => {
    const {offset, guides} = snapMove(
      {x: 3, y: 10, width: 20, height: 20},
      snapTargets([]),
      DISTANCE,
    );
    expect(offset).toEqual({x: -3, y: -3});
    expect(guides).toEqual([]);
  });

  it('puts the given side of the box onto the grid', () => {
    const {offset} = snapMove(
      {x: 0, y: 0, width: 20, height: 20},
      snapTargets([]),
      DISTANCE,
      'center',
    );
    expect(offset).toEqual({x: -3, y: -3});
  });

  it('lines up an edge with the edge of an element close by', () => {
    const target = {x: 100, y: 0, width: 50, height: 50};
    const {offset, guides} = snapMove(
      {x: 102, y: 200, width: 20, height: 20},
      snapTargets([target]),
      DISTANCE,
    );

    expect(offset.x).toBe(-2);
    expect(guides).toEqual([
      {axis: 'x', kind: 'edge', value: 100, from: 0, to: 223},
    ]);
  });

  it('lines up a center with the center of an element', () => {
    const target = {x: 0, y: 0, width: 100, height: 100};
    const {offset, guides} = snapMove(
      {x: 42, y: 300, width: 20, height: 20},
      snapTargets([target]),
      DISTANCE,
    );

    expect(offset.x).toBe(-2);
    expect(guides).toEqual([
      {axis: 'x', kind: 'center', value: 50, from: 0, to: 321},
    ]);
  });

  it('does not line up a center with an edge', () => {
    const target = {x: 100, y: 0, width: 50, height: 50};
    const {offset, guides} = snapMove(
      {x: 89, y: 300, width: 20, height: 20},
      snapTargets([target]),
      DISTANCE,
    );

    expect(offset.x).toBe(2);
    expect(guides).toEqual([]);
  });

  it('snaps to the closest of several elements', () => {
    const {offset} = snapMove(
      {x: 100, y: 300, width: 20, height: 20},
      snapTargets([
        {x: 104, y: 0, width: 50, height: 50},
        {x: 0, y: 0, width: 99, height: 50},
      ]),
      DISTANCE,
    );
    expect(offset.x).toBe(-1);
  });

  it('snaps to an element close to the grid instead of ending up next to it', () => {
    const {offset} = snapMove(
      {x: 4, y: 300, width: 20, height: 20},
      snapTargets([{x: 12, y: 0, width: 100, height: 50}]),
      DISTANCE,
    );
    expect(offset.x).toBe(8);
  });

  it('puts the box in the middle between its neighbours', () => {
    const before = {x: 0, y: 0, width: 50, height: 50};
    const after = {x: 150, y: 0, width: 50, height: 50};
    const {offset, guides} = snapMove(
      {x: 73, y: 0, width: 50, height: 50},
      snapTargets([], [before, after]),
      DISTANCE,
    );

    expect(offset.x).toBe(2);
    expect(guides).toEqual([
      {axis: 'x', kind: 'gap', value: 50, from: 50, to: 75},
      {axis: 'x', kind: 'gap', value: 50, from: 125, to: 150},
    ]);
  });

  it('repeats the gap between two elements of its row', () => {
    const {offset, guides} = snapMove(
      {x: 203, y: 0, width: 50, height: 50},
      snapTargets(
        [],
        [
          {x: 0, y: 0, width: 50, height: 50},
          {x: 100, y: 0, width: 50, height: 50},
        ],
      ),
      DISTANCE,
    );

    expect(offset.x).toBe(-3);
    expect(guides.map(guide => [guide.from, guide.to])).toEqual([
      [150, 200],
      [50, 100],
    ]);
  });

  it('ignores elements that are not in the row of the box', () => {
    const {offset} = snapMove(
      {x: 73, y: 500, width: 50, height: 50},
      snapTargets(
        [],
        [
          {x: 0, y: 0, width: 50, height: 50},
          {x: 150, y: 0, width: 50, height: 50},
        ],
      ),
      DISTANCE,
    );
    expect(offset.x).toBe(-3);
  });
});

describe('snapResize', () => {
  const box = {x: 0, y: 0, width: 100, height: 100};

  it('snaps the end edge that is dragged and grows the box', () => {
    const {box: snapped, guides} = snapResize(
      box,
      [1, 0],
      false,
      snapTargets([{x: 103, y: 300, width: 50, height: 50}]),
      DISTANCE,
    );

    expect(snapped).toEqual({x: 0, y: 0, width: 103, height: 100});
    expect(guides).toEqual([
      {axis: 'x', kind: 'edge', value: 103, from: 0, to: 350},
    ]);
  });

  it('snaps the start edge that is dragged and moves the box', () => {
    const {box: snapped} = snapResize(
      box,
      [-1, 0],
      false,
      snapTargets([{x: -54, y: 300, width: 50, height: 50}]),
      DISTANCE,
    );
    expect(snapped).toEqual({x: -4, y: 0, width: 104, height: 100});
  });

  it('moves the opposite edge as well when resized from the center', () => {
    const {box: snapped} = snapResize(
      box,
      [1, 0],
      true,
      snapTargets([{x: 103, y: 300, width: 50, height: 50}]),
      DISTANCE,
    );
    expect(snapped).toEqual({x: -3, y: 0, width: 106, height: 100});
  });

  it('snaps an edge without elements nearby onto the grid', () => {
    const {box: snapped} = snapResize(
      {x: 0, y: 0, width: 100, height: 100},
      [0, 1],
      false,
      snapTargets([]),
      DISTANCE,
    );
    expect(snapped).toEqual({x: 0, y: 0, width: 100, height: 98});
  });

  it('does not snap an edge that would make the box smaller than a pixel', () => {
    const small = {x: 0, y: 0, width: 2, height: 2};
    const {box: snapped, guides} = snapResize(
      small,
      [1, 0],
      false,
      snapTargets([{x: 0.5, y: 300, width: 0, height: 0}]),
      DISTANCE,
    );

    expect(snapped).toEqual(small);
    expect(guides).toEqual([]);
  });
});

describe('snapPoint', () => {
  it('puts a point onto the grid without elements nearby', () => {
    expect(snapPoint({x: 3, y: 4}, snapTargets([]), DISTANCE)).toEqual({
      position: {x: 0, y: 7},
      guides: [],
    });
  });

  it('snaps a point to the edges and centers of an element', () => {
    const {position, guides} = snapPoint(
      {x: 52, y: 103},
      snapTargets([{x: 0, y: 0, width: 100, height: 100}]),
      DISTANCE,
    );

    expect(position).toEqual({x: 50, y: 100});
    expect(guides).toEqual([
      {axis: 'x', kind: 'center', value: 50, from: 0, to: 100},
      {axis: 'y', kind: 'edge', value: 100, from: 0, to: 100},
    ]);
  });
});
