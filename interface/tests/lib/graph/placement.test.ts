import {describe, expect, it} from 'vitest';

import {
  GRID_SPACING,
  OccupiedPositions,
  placeNodes,
} from '@sb/lib/graph/placement';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {TopologyAnnotations} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

const format = new ContainerlabFormat(() => null);

function topology(nodes: string[], links: [string, string][] = []) {
  const nodeLines = nodes.map(node => `    ${node}: {}`).join('\n');
  const linkLines = links
    .map(([a, b]) => `    - endpoints: ["${a}:eth1", "${b}:eth1"]`)
    .join('\n');

  return format.read(
    `name: lab\ntopology:\n  nodes:\n${nodeLines}\n` +
      (links.length > 0 ? `  links:\n${linkLines}\n` : ''),
  )!;
}

function positioned(positions: Record<string, Position>): TopologyAnnotations {
  return {
    nodeAnnotations: Object.entries(positions).map(([id, position]) => ({
      id,
      position,
    })),
  };
}

function minDistance(positions: Position[]) {
  let min = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      min = Math.min(
        min,
        Math.hypot(
          positions[i].x - positions[j].x,
          positions[i].y - positions[j].y,
        ),
      );
    }
  }
  return min;
}

const names = (count: number, prefix = 'n') =>
  [...Array(count)].map((_, index) => `${prefix}${index}`);

describe('OccupiedPositions', () => {
  it('counts every position as free without nodes', () => {
    expect(new OccupiedPositions().isFree({x: 0, y: 0})).toBe(true);
  });

  it('counts positions closer than two grid cells to a node as taken', () => {
    const occupied = new OccupiedPositions([{x: 0, y: 0}]);
    expect(occupied.isFree({x: 69, y: 0})).toBe(false);
    expect(occupied.isFree({x: -40, y: -40})).toBe(false);
    expect(occupied.isFree({x: 70, y: 0})).toBe(true);
    expect(occupied.isFree({x: 50, y: 50})).toBe(true);
  });

  it('finds nodes in neighbouring cells', () => {
    const occupied = new OccupiedPositions();
    occupied.add({x: 139, y: 0});
    expect(occupied.isFree({x: 141, y: 0})).toBe(false);
    expect(occupied.isFree({x: 209, y: 0})).toBe(true);
  });

  it('returns the closest grid spot to a free position', () => {
    expect(new OccupiedPositions().findFreePosition({x: 60, y: 20})).toEqual({
      x: 2 * GRID_SPACING,
      y: GRID_SPACING,
    });
  });

  it('returns a free grid spot next to a taken position', () => {
    const occupied = new OccupiedPositions([{x: 0, y: 0}]);
    const position = occupied.findFreePosition({x: 0, y: 0});

    expect(occupied.isFree(position)).toBe(true);
    expect(Number.isInteger(position.x / GRID_SPACING)).toBe(true);
    expect(Number.isInteger(position.y / GRID_SPACING)).toBe(true);
    expect(Math.hypot(position.x, position.y)).toBeLessThan(3 * GRID_SPACING);
  });
});

describe('placeNodes', () => {
  it('places nothing when all nodes have a position', () => {
    const definition = topology(['a', 'b']);
    expect(
      placeNodes(definition, positioned({a: {x: 0, y: 0}, b: {x: 9, y: 9}}))
        .size,
    ).toBe(0);
  });

  it('places all nodes without a position apart from each other', () => {
    const definition = topology(names(8), [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n3', 'n0'],
      ['n4', 'n5'],
    ]);
    const positions = placeNodes(definition, {});

    expect([...positions.keys()].toSorted()).toEqual(names(8).toSorted());
    expect(minDistance([...positions.values()])).toBeGreaterThanOrEqual(70);
  });

  it('returns the same placement for the same definition and annotations', () => {
    const definition = topology(['a', 'b'], [['a', 'b']]);
    const annotations = {};
    expect(placeNodes(definition, annotations)).toBe(
      placeNodes(definition, annotations),
    );
  });

  it('places the same topology the same way every time', () => {
    const source = names(6, 'd');
    const links: [string, string][] = [
      ['d0', 'd1'],
      ['d1', 'd2'],
      ['d2', 'd3'],
      ['d3', 'd4'],
      ['d4', 'd5'],
    ];
    const first = placeNodes(topology(source, links), {});

    // Fills the cache of placed topologies so the topology is laid out again
    for (let i = 0; i < 25; i++) {
      placeNodes(topology([`filler${i}`]), {});
    }

    const second = placeNodes(topology(source, links), {});
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('places a single node next to the node it is linked to', () => {
    const definition = topology(['a', 'b'], [['a', 'b']]);
    const position = placeNodes(
      definition,
      positioned({a: {x: 350, y: 350}}),
    ).get('b')!;

    expect(
      Math.hypot(position.x - 350, position.y - 350),
    ).toBeGreaterThanOrEqual(70);
    expect(Math.hypot(position.x - 350, position.y - 350)).toBeLessThan(140);
  });

  it('places a single unlinked node to the right of the graph', () => {
    const definition = topology(['a', 'b', 'c']);
    const positions = placeNodes(
      definition,
      positioned({a: {x: 0, y: 0}, b: {x: 140, y: 70}}),
    );
    expect(positions.get('c')).toEqual({x: 210, y: 0});
  });

  it('lays out linked nodes together next to the graph', () => {
    const definition = topology(
      ['a', 'b', 'c', 'd'],
      [
        ['b', 'c'],
        ['c', 'd'],
      ],
    );
    const positions = placeNodes(definition, positioned({a: {x: 0, y: 0}}));

    expect([...positions.keys()].toSorted()).toEqual(['b', 'c', 'd']);
    for (const position of positions.values()) {
      expect(position.x).toBeGreaterThanOrEqual(140);
    }
    expect(
      Math.min(...[...positions.values()].map(position => position.y)),
    ).toBe(0);
  });

  it('lays out large topologies in circles with unlinked nodes next to them', () => {
    const nodes = names(110);
    const links = names(100).map((name, index): [string, string] => [
      name,
      `n${(index + 1) % 100}`,
    ]);
    const positions = placeNodes(topology(nodes, links), {});

    expect(positions.size).toBe(110);

    const linkedX = names(100).map(name => positions.get(name)!.x);
    const unlinked = names(110)
      .slice(100)
      .map(name => positions.get(name)!);
    for (const position of unlinked) {
      expect(position.x).toBeGreaterThan(Math.max(...linkedX));
    }
    expect(minDistance(unlinked)).toBe(70);
  });
});
