import {describe, expect, it} from 'vitest';

import {
  annotationBoxes,
  boxBetween,
  boxCenter,
  boxesOverlap,
  containsBox,
  containsPoint,
  drawnShapeGeometry,
  fitIntoGroupBox,
  GraphGroup,
  GraphShape,
  groupAt,
  groupBoxAround,
  groupBoxAroundBoxes,
  groupContents,
  GroupHitPart,
  groupInnerBox,
  groupLabelBox,
  groupLabelInset,
  groupParentId,
  growBox,
  growGroupBox,
  hitTestLayers,
  isShapeHit,
  layerHits,
  legacyGroupId,
  minGroupSize,
  moveBox,
  moveShapeGeometry,
  nodeBox,
  nodeGroupId,
  nodeIconBox,
  nodeShapeBox,
  placedGeometry,
  readGraphGroups,
  readGraphShapes,
  readGraphTexts,
  readLayerItems,
  roundCoordinate,
  roundPosition,
  scaleTransform,
  shapeBox,
  shapeGeometry,
  shiftIntoBox,
  storedTextBox,
  textAt,
  textBox,
  transformShapeGeometry,
  translateTransform,
  unionBox,
} from '@sb/lib/graph/annotation-geometry';
import {
  FreeShapeAnnotation,
  FreeTextAnnotation,
  GroupStyleAnnotation,
} from '@sb/types/domain/topology';

function groupAnnotation(
  id: string,
  fields: Partial<GroupStyleAnnotation> = {},
): GroupStyleAnnotation {
  return {
    id,
    name: id,
    level: '1',
    position: {x: 0, y: 0},
    width: 200,
    height: 100,
    ...fields,
  };
}

function graphGroup(id: string, fields: Partial<GraphGroup> = {}): GraphGroup {
  return {
    id,
    name: id,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    memberIds: [],
    shapeIds: [],
    textIds: [],
    groupIds: [],
    parentId: null,
    annotation: null,
    ...fields,
  };
}

function shape(
  id: string,
  fields: Partial<FreeShapeAnnotation> = {},
): GraphShape {
  return {
    id,
    annotation: {
      id,
      shapeType: 'rectangle',
      position: {x: 0, y: 0},
      width: 100,
      height: 50,
      fillColor: '#ffffff',
      ...fields,
    },
  };
}

function text(
  id: string,
  fields: Partial<FreeTextAnnotation> = {},
): FreeTextAnnotation {
  return {id, text: id, position: {x: 0, y: 0}, ...fields};
}

describe('node boxes', () => {
  it('centres the icon box on the node position', () => {
    expect(nodeIconBox({x: 100, y: 50})).toEqual({
      x: 68,
      y: 18,
      width: 64,
      height: 64,
    });
  });

  it('includes the label below the icon in the node box', () => {
    expect(nodeBox({x: 0, y: 0})).toEqual({
      x: -32,
      y: -32,
      width: 64,
      height: 89,
    });
  });

  it('insets the shape box by the inset of the icon shape', () => {
    expect(nodeShapeBox({x: 0, y: 0}, 'ellipse')).toEqual({
      x: -30,
      y: -30,
      width: 60,
      height: 60,
    });
  });

  it('uses the full icon box for unknown icon shapes', () => {
    expect(nodeShapeBox({x: 0, y: 0}, 'star')).toEqual(
      nodeIconBox({x: 0, y: 0}),
    );
  });
});

describe('unionBox', () => {
  it('returns null without boxes', () => {
    expect(unionBox([])).toBeNull();
  });

  it('returns the smallest box around all boxes', () => {
    expect(
      unionBox([
        {x: 0, y: 10, width: 10, height: 10},
        {x: -5, y: 0, width: 5, height: 5},
        {x: 20, y: 20, width: 10, height: 30},
      ]),
    ).toEqual({x: -5, y: 0, width: 35, height: 50});
  });
});

describe('group boxes', () => {
  it('returns null for a group without members', () => {
    expect(groupBoxAround([])).toBeNull();
    expect(groupBoxAroundBoxes([])).toBeNull();
  });

  it('pads the box around the members and leaves room for the label', () => {
    expect(
      groupBoxAroundBoxes([{x: 0, y: 0, width: 100, height: 100}]),
    ).toEqual({x: -24, y: -38, width: 148, height: 162});
  });

  it('places the box around the node boxes of the positions', () => {
    expect(groupBoxAround([{x: 0, y: 0}])).toEqual(
      groupBoxAroundBoxes([nodeBox({x: 0, y: 0})]),
    );
  });

  it('rounds the box to two decimals', () => {
    const box = groupBoxAroundBoxes([
      {x: 0.123456, y: 0.987654, width: 1.11111, height: 1},
    ])!;
    expect(box.x).toBe(-23.88);
    expect(box.y).toBe(-37.01);
  });

  it('keeps a group box that already contains its members', () => {
    const box = {x: -100, y: -100, width: 400, height: 400};
    expect(growGroupBox(box, [{x: 0, y: 0, width: 10, height: 10}])).toBe(box);
  });

  it('keeps a group box when there are no members', () => {
    const box = {x: 0, y: 0, width: 10, height: 10};
    expect(growGroupBox(box, [])).toBe(box);
  });

  it('grows a group box so it contains a member outside of it', () => {
    expect(
      growGroupBox({x: 0, y: 0, width: 100, height: 100}, [
        {x: 200, y: 0, width: 10, height: 10},
      ]),
    ).toEqual({x: 0, y: -38, width: 234, height: 138});
  });

  it('returns the size the largest member needs on its own', () => {
    expect(
      minGroupSize([
        {x: 0, y: 0, width: 100, height: 10},
        {x: 500, y: 500, width: 10, height: 50},
      ]),
    ).toEqual({width: 148, height: 112});
  });

  it('returns a zero size without members', () => {
    expect(minGroupSize([])).toEqual({width: 0, height: 0});
  });

  it('returns the inner box as the inverse of the padding', () => {
    const member = {x: 10, y: 20, width: 30, height: 40};
    expect(groupInnerBox(groupBoxAroundBoxes([member])!)).toEqual(member);
  });
});

describe('box helpers', () => {
  it('counts boxes that only touch as overlapping', () => {
    expect(
      boxesOverlap(
        {x: 0, y: 0, width: 10, height: 10},
        {x: 10, y: 10, width: 5, height: 5},
      ),
    ).toBe(true);
  });

  it('does not count separate boxes as overlapping', () => {
    expect(
      boxesOverlap(
        {x: 0, y: 0, width: 10, height: 10},
        {x: 11, y: 0, width: 5, height: 5},
      ),
    ).toBe(false);
  });

  it('returns the centre of a box', () => {
    expect(boxCenter({x: 10, y: 20, width: 30, height: 40})).toEqual({
      x: 25,
      y: 40,
    });
  });

  it('includes the edges in containsPoint', () => {
    const box = {x: 0, y: 0, width: 10, height: 10};
    expect(containsPoint(box, {x: 10, y: 0})).toBe(true);
    expect(containsPoint(box, {x: 10.01, y: 0})).toBe(false);
  });

  it('contains a box that is equal to it', () => {
    const box = {x: 0, y: 0, width: 10, height: 10};
    expect(containsBox(box, {...box})).toBe(true);
    expect(containsBox(box, {...box, width: 11})).toBe(false);
  });

  it('spans a box between two corners in any order', () => {
    expect(boxBetween({x: 10, y: 0}, {x: 0, y: 20})).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 20,
    });
  });

  it('moves a box by a delta', () => {
    expect(moveBox({x: 1, y: 2, width: 3, height: 4}, {x: 10, y: -2})).toEqual({
      x: 11,
      y: 0,
      width: 3,
      height: 4,
    });
  });

  it('grows and shrinks a box on every side', () => {
    expect(growBox({x: 0, y: 0, width: 10, height: 10}, 2)).toEqual({
      x: -2,
      y: -2,
      width: 14,
      height: 14,
    });
    expect(growBox({x: 0, y: 0, width: 10, height: 10}, -2)).toEqual({
      x: 2,
      y: 2,
      width: 6,
      height: 6,
    });
  });

  it('rounds coordinates to two decimals', () => {
    expect(roundCoordinate(1.005)).toBe(1);
    expect(roundCoordinate(1.236)).toBe(1.24);
    expect(roundPosition({x: 0.111, y: -0.119})).toEqual({x: 0.11, y: -0.12});
  });
});

describe('shiftIntoBox', () => {
  const outer = {x: 0, y: 0, width: 100, height: 100};

  it('does not move a box that is already inside', () => {
    expect(shiftIntoBox(outer, {x: 10, y: 10, width: 10, height: 10})).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('moves a box back in over the far edges', () => {
    expect(shiftIntoBox(outer, {x: 95, y: 98, width: 10, height: 10})).toEqual({
      x: -5,
      y: -8,
    });
  });

  it('moves a box back in over the near edges', () => {
    expect(shiftIntoBox(outer, {x: -5, y: -3, width: 10, height: 10})).toEqual({
      x: 5,
      y: 3,
    });
  });

  it('aligns a box that is too large with the top left corner', () => {
    expect(
      shiftIntoBox(outer, {x: 20, y: 30, width: 200, height: 200}),
    ).toEqual({x: -20, y: -30});
  });
});

describe('fitIntoGroupBox', () => {
  const box = {x: 0, y: 0, width: 400, height: 400};

  it('keeps a node that already fits', () => {
    expect(fitIntoGroupBox(box, {x: 200, y: 200})).toEqual({x: 200, y: 200});
  });

  it('clamps a node into the group with the group padding', () => {
    expect(fitIntoGroupBox(box, {x: -100, y: 1000})).toEqual({
      x: 56,
      y: 319,
    });
    expect(fitIntoGroupBox(box, {x: 1000, y: -100})).toEqual({
      x: 344,
      y: 70,
    });
  });

  it('centres a node in a group that is too small for it', () => {
    expect(
      fitIntoGroupBox({x: 0, y: 0, width: 50, height: 50}, {x: 0, y: 0}),
    ).toEqual({x: 25, y: 19.5});
  });
});

describe('nodeGroupId', () => {
  const groups = [
    groupAnnotation('g1', {name: 'Core'}),
    groupAnnotation('g2', {name: 'g1'}),
  ];

  it('returns null without a membership or group', () => {
    expect(nodeGroupId(undefined, groups)).toBeNull();
    expect(nodeGroupId({}, groups)).toBeNull();
  });

  it('prefers the group ID', () => {
    expect(nodeGroupId({groupId: 'other', group: 'Core'}, groups)).toBe(
      'other',
    );
  });

  it('resolves a legacy group by ID before its name', () => {
    expect(nodeGroupId({group: 'g1'}, groups)).toBe('g1');
    expect(nodeGroupId({group: 'Core'}, groups)).toBe('g1');
  });

  it('falls back to a legacy ID made of the group and level', () => {
    expect(nodeGroupId({group: 'Edge', level: '2'}, groups)).toBe('Edge:2');
    expect(nodeGroupId({group: 'Edge'}, groups)).toBe('Edge');
  });

  it('builds legacy IDs with and without a level', () => {
    expect(legacyGroupId('a', '1')).toBe('a:1');
    expect(legacyGroupId('a', '')).toBe('a:');
    expect(legacyGroupId('a')).toBe('a');
  });
});

describe('groupParentId', () => {
  it('prefers the parent ID over the legacy group ID', () => {
    expect(
      groupParentId(groupAnnotation('a', {parentId: 'b', groupId: 'c'})),
    ).toBe('b');
    expect(groupParentId(groupAnnotation('a', {groupId: 'c'}))).toBe('c');
    expect(groupParentId(groupAnnotation('a'))).toBeNull();
  });
});

describe('readGraphGroups', () => {
  it('reads the members, shapes, texts and nested groups of each group', () => {
    const groups = readGraphGroups(
      [groupAnnotation('outer'), groupAnnotation('inner', {parentId: 'outer'})],
      [
        {name: 'n1', position: {x: 0, y: 0}, groupId: 'outer'},
        {name: 'n2', position: {x: 0, y: 0}, groupId: 'inner'},
        {name: 'n3', position: {x: 0, y: 0}},
      ],
      [shape('s1', {groupId: 'inner'}).annotation],
      [text('t1', {groupId: 'outer'}), text('t2', {groupId: 'missing'})],
    );

    expect(groups.map(group => group.id)).toEqual(['outer', 'inner']);
    expect(groups[0]).toMatchObject({
      memberIds: ['n1'],
      textIds: ['t1'],
      shapeIds: [],
      groupIds: ['inner'],
      parentId: null,
    });
    expect(groups[1]).toMatchObject({
      memberIds: ['n2'],
      shapeIds: ['s1'],
      parentId: 'outer',
    });
  });

  it('places legacy groups around their members', () => {
    const groups = readGraphGroups(
      [],
      [
        {name: 'n1', position: {x: 0, y: 0}, group: 'Core', level: '1'},
        {name: 'n2', position: {x: 100, y: 0}, group: 'Core', level: '1'},
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'Core:1',
      name: 'Core',
      memberIds: ['n1', 'n2'],
      annotation: null,
      ...groupBoxAround([
        {x: 0, y: 0},
        {x: 100, y: 0},
      ]),
    });
  });

  it('draws legacy groups behind groups with annotations', () => {
    const groups = readGraphGroups(
      [groupAnnotation('g', {zIndex: -100})],
      [{name: 'n1', position: {x: 0, y: 0}, group: 'Legacy'}],
    );
    expect(groups.map(group => group.id)).toEqual(['Legacy', 'g']);
  });

  it('orders siblings by their z-index and nested groups after their parent', () => {
    const groups = readGraphGroups(
      [
        groupAnnotation('a', {zIndex: 2}),
        groupAnnotation('b', {zIndex: 1}),
        groupAnnotation('a1', {parentId: 'a', zIndex: -5}),
        groupAnnotation('b1', {parentId: 'b'}),
      ],
      [],
    );
    expect(groups.map(group => group.id)).toEqual(['b', 'b1', 'a', 'a1']);
  });

  it('ignores parents that do not exist', () => {
    const groups = readGraphGroups(
      [groupAnnotation('a', {parentId: 'missing'})],
      [],
    );
    expect(groups[0].parentId).toBeNull();
  });

  it('ignores parents that would nest a group in itself', () => {
    const groups = readGraphGroups(
      [
        groupAnnotation('a', {parentId: 'b'}),
        groupAnnotation('b', {parentId: 'a'}),
        groupAnnotation('c', {parentId: 'c'}),
      ],
      [],
    );

    expect(groups.map(group => group.parentId)).toEqual([null, null, null]);
    expect(groups.flatMap(group => group.groupIds)).toEqual([]);
  });

  it('keeps a group nested in a valid chain', () => {
    const groups = readGraphGroups(
      [
        groupAnnotation('a'),
        groupAnnotation('b', {parentId: 'a'}),
        groupAnnotation('c', {groupId: 'b'}),
      ],
      [],
    );
    expect(groups.map(group => [group.id, group.parentId])).toEqual([
      ['a', null],
      ['b', 'a'],
      ['c', 'b'],
    ]);
  });
});

describe('groupContents', () => {
  const groups = [
    graphGroup('a', {
      memberIds: ['n1'],
      shapeIds: ['s1'],
      groupIds: ['b'],
    }),
    graphGroup('b', {
      memberIds: ['n2', 'n3'],
      textIds: ['t1'],
      groupIds: ['c'],
      parentId: 'a',
    }),
    graphGroup('c', {shapeIds: ['s2'], parentId: 'b'}),
    graphGroup('d', {memberIds: ['n4']}),
  ];

  it('includes the contents of nested groups', () => {
    expect(groupContents(groups, 'a')).toEqual({
      nodeIds: ['n1', 'n2', 'n3'],
      groupIds: ['b', 'c'],
      shapeIds: ['s1', 's2'],
      textIds: ['t1'],
    });
  });

  it('does not include the group itself or its parents', () => {
    expect(groupContents(groups, 'b')).toEqual({
      nodeIds: ['n2', 'n3'],
      groupIds: ['c'],
      shapeIds: ['s2'],
      textIds: ['t1'],
    });
  });

  it('returns nothing for a group that does not exist', () => {
    expect(groupContents(groups, 'missing')).toEqual({
      nodeIds: [],
      groupIds: [],
      shapeIds: [],
      textIds: [],
    });
  });
});

describe('groupAt', () => {
  it('returns the topmost group at a position', () => {
    const groups = [
      graphGroup('bottom'),
      graphGroup('top', {x: 50, y: 50, width: 50, height: 50}),
    ];
    expect(groupAt(groups, {x: 60, y: 60})?.id).toBe('top');
    expect(groupAt(groups, {x: 10, y: 10})?.id).toBe('bottom');
    expect(groupAt(groups, {x: 500, y: 10})).toBeNull();
  });
});

describe('group labels', () => {
  it('moves the label in from a rounded corner', () => {
    expect(groupLabelInset({x: 0, y: 0, width: 100, height: 100}, 0)).toBe(0);
    expect(
      groupLabelInset({x: 0, y: 0, width: 100, height: 100}, 20),
    ).toBeCloseTo(20 * (1 - Math.SQRT1_2));
  });

  it('limits the corner radius to half the size of the group', () => {
    expect(groupLabelInset({x: 0, y: 0, width: 10, height: 100}, 50)).toBe(
      groupLabelInset({x: 0, y: 0, width: 10, height: 100}, 5),
    );
  });

  it('sizes the label by the length of the name', () => {
    const box = groupLabelBox(
      graphGroup('g', {
        name: 'abcd',
        annotation: groupAnnotation('g', {borderRadius: 0}),
      }),
    );
    expect(box).toEqual({x: 0, y: 0, width: 54, height: 28});
  });

  it('does not make the label wider than the group', () => {
    const box = groupLabelBox(
      graphGroup('g', {name: 'a'.repeat(100), width: 80}),
    );
    expect(box.width).toBe(80);
  });
});

describe('hitTestLayers', () => {
  it('returns null when nothing is hit', () => {
    expect(hitTestLayers([], {x: 0, y: 0}, 2)).toBeNull();
  });

  it('tells the label of a group apart from its body', () => {
    const group = graphGroup('g', {
      annotation: groupAnnotation('g', {borderRadius: 0}),
    });
    const items = readLayerItems([group], []);

    expect(hitTestLayers(items, {x: 5, y: 5}, 2)).toMatchObject({
      kind: 'group',
      part: GroupHitPart.Label,
    });
    expect(hitTestLayers(items, {x: 150, y: 80}, 2)).toMatchObject({
      kind: 'group',
      part: GroupHitPart.Body,
    });
  });

  it('returns the topmost item and yields the others below it', () => {
    const group = graphGroup('g');
    const top = shape('s', {position: {x: 10, y: 50}, zIndex: 1});
    const items = readLayerItems([group], [top]);

    expect(hitTestLayers(items, {x: 20, y: 60}, 2)).toMatchObject({
      kind: 'shape',
      shape: top,
    });
    expect(
      [...layerHits(items, {x: 20, y: 60}, 2)].map(hit => hit.kind),
    ).toEqual(['shape', 'group']);
  });
});

describe('isShapeHit', () => {
  const hit = (item: GraphShape, x: number, y: number, tolerance = 2) =>
    isShapeHit(item, shapeGeometry(item.annotation), {x, y}, tolerance);

  it('hits a filled rectangle anywhere inside it', () => {
    const rectangle = shape('r');
    expect(hit(rectangle, 50, 25)).toBe(true);
    expect(hit(rectangle, 101, 25)).toBe(true);
    expect(hit(rectangle, 103, 25)).toBe(false);
  });

  it('hits a rectangle without a fill only near its outline', () => {
    const transparent = shape('r', {fillColor: 'transparent'});
    expect(hit(transparent, 50, 25)).toBe(false);
    expect(hit(transparent, 1, 25)).toBe(true);

    const invisible = shape('r', {fillOpacity: 0});
    expect(hit(invisible, 50, 25)).toBe(false);
  });

  it('widens the outline by half the border width', () => {
    const rectangle = shape('r', {borderWidth: 10});
    expect(hit(rectangle, 106, 25)).toBe(true);
    expect(hit(rectangle, 108, 25)).toBe(false);
  });

  it('hits a circle inside the ellipse but not in the corners of its box', () => {
    const circle = shape('c', {shapeType: 'circle', width: 100, height: 100});
    expect(hit(circle, 50, 50)).toBe(true);
    expect(hit(circle, 2, 2)).toBe(false);
  });

  it('hits a circle without a fill only near its outline', () => {
    const circle = shape('c', {
      shapeType: 'circle',
      width: 100,
      height: 100,
      fillColor: 'transparent',
    });
    expect(hit(circle, 50, 50)).toBe(false);
    expect(hit(circle, 0, 50)).toBe(true);
  });

  it('hits a line near the segment but not past its ends', () => {
    const line = shape('l', {
      shapeType: 'line',
      position: {x: 0, y: 0},
      endPosition: {x: 100, y: 0},
    });
    expect(hit(line, 50, 1.5)).toBe(true);
    expect(hit(line, 50, 3)).toBe(false);
    expect(hit(line, 103, 0)).toBe(false);
  });

  it('hits a line of zero length at its point', () => {
    const line = shape('l', {
      shapeType: 'line',
      position: {x: 0, y: 0},
      endPosition: {x: 0, y: 0},
    });
    expect(hit(line, 1, 1)).toBe(true);
    expect(hit(line, 3, 3)).toBe(false);
  });
});

describe('texts', () => {
  it('orders texts by their z-index and keeps the order of equal ones', () => {
    const texts = readGraphTexts([
      text('a', {zIndex: 1}),
      text('b'),
      text('c', {zIndex: -1}),
      text('d'),
    ]);
    expect(texts.map(item => item.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('returns no box for a text that was not rendered', () => {
    expect(textBox(text('a'), undefined)).toBeNull();
    expect(textBox(text('a'), {width: 10, height: 20})).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 20,
    });
  });

  it('uses the stored or default size for texts that were not rendered', () => {
    expect(storedTextBox(text('a', {position: {x: 5, y: 6}}))).toEqual({
      x: 5,
      y: 6,
      width: 240,
      height: 60,
    });
    expect(storedTextBox(text('a', {width: 10, height: 20}))).toMatchObject({
      width: 10,
      height: 20,
    });
  });

  it('returns the topmost rendered text at a position', () => {
    const texts = readGraphTexts([text('a'), text('b'), text('c')]);
    const sizes = new Map([
      ['a', {width: 100, height: 100}],
      ['b', {width: 10, height: 10}],
    ]);

    expect(textAt(texts, sizes, {x: 5, y: 5})?.id).toBe('b');
    expect(textAt(texts, sizes, {x: 50, y: 50})?.id).toBe('a');
    expect(textAt(texts, sizes, {x: 500, y: 50})).toBeNull();
  });
});

describe('annotationBoxes', () => {
  it('returns the boxes of groups, shapes and texts', () => {
    const group = graphGroup('g', {x: 1, y: 2, width: 3, height: 4});
    const items = readLayerItems(
      [group],
      [shape('s', {position: {x: 10, y: 10}})],
    );
    const texts = readGraphTexts([text('t1'), text('t2')]);

    expect(
      annotationBoxes(items, texts, new Map([['t1', {width: 5, height: 5}]])),
    ).toEqual([
      group,
      {x: 10, y: 10, width: 100, height: 50},
      {x: 0, y: 0, width: 5, height: 5},
      {x: 0, y: 0, width: 240, height: 60},
    ]);
  });
});

describe('readLayerItems', () => {
  it('draws groups before shapes of the same z-index', () => {
    const items = readLayerItems(
      [graphGroup('g', {annotation: groupAnnotation('g')})],
      [shape('s')],
    );
    expect(items.map(item => item.id)).toEqual(['g', 's']);
  });

  it('draws shapes of a group on top of it', () => {
    const items = readLayerItems(
      [
        graphGroup('a', {annotation: groupAnnotation('a', {zIndex: 5})}),
        graphGroup('b', {annotation: groupAnnotation('b', {zIndex: 1})}),
      ],
      [shape('s', {groupId: 'b', zIndex: -10}), shape('free', {zIndex: 3})],
    );
    expect(items.map(item => item.id)).toEqual(['b', 's', 'free', 'a']);
  });

  it('draws shapes in groups that do not exist at the top level', () => {
    const items = readLayerItems([], [shape('s', {groupId: 'missing'})]);
    expect(items.map(item => item.id)).toEqual(['s']);
  });

  it('wraps shapes with their ID', () => {
    const annotation = shape('s').annotation;
    expect(readGraphShapes([annotation])).toEqual([{id: 's', annotation}]);
  });
});

describe('shape geometry', () => {
  it('fills in the default size of rectangles and circles', () => {
    expect(
      shapeGeometry({id: 's', shapeType: 'circle', position: {x: 1, y: 2}}),
    ).toEqual({position: {x: 1, y: 2}, width: 160, height: 100});
  });

  it('fills in a horizontal end position for lines', () => {
    expect(
      shapeGeometry({id: 's', shapeType: 'line', position: {x: 1, y: 2}}),
    ).toEqual({position: {x: 1, y: 2}, endPosition: {x: 161, y: 2}});
  });

  it('places texts, groups and shapes with their default sizes', () => {
    const position = {x: 0, y: 0};
    expect(placedGeometry('text', position)).toEqual({
      position,
      width: 240,
      height: 60,
    });
    expect(placedGeometry('group', position)).toEqual({
      position,
      width: 240,
      height: 160,
    });
    expect(placedGeometry('rectangle', position)).toEqual({
      position,
      width: 160,
      height: 100,
    });
    expect(placedGeometry('line', position)).toEqual({
      position,
      endPosition: {x: 160, y: 0},
    });
  });

  it('returns the box of a line between its ends', () => {
    expect(
      shapeBox({position: {x: 10, y: 10}, endPosition: {x: 0, y: 20}}),
    ).toEqual({x: 0, y: 10, width: 10, height: 10});
  });

  it('returns an empty box for a geometry without a size', () => {
    expect(shapeBox({position: {x: 1, y: 2}})).toEqual({
      x: 1,
      y: 2,
      width: 0,
      height: 0,
    });
  });

  it('moves both ends of a line and rounds them', () => {
    expect(
      moveShapeGeometry(
        {position: {x: 0, y: 0}, endPosition: {x: 10, y: 10}},
        {x: 0.111, y: 1},
      ),
    ).toEqual({position: {x: 0.11, y: 1}, endPosition: {x: 10.11, y: 11}});
  });

  it('moves a box without adding an end position', () => {
    const moved = moveShapeGeometry(
      {position: {x: 0, y: 0}, width: 10, height: 10},
      {x: 5, y: 5},
    );
    expect(moved).toEqual({position: {x: 5, y: 5}, width: 10, height: 10});
    expect('endPosition' in moved).toBe(false);
  });
});

describe('selection transforms', () => {
  it('translates positions and boxes', () => {
    const transform = translateTransform({x: 10, y: -5});
    expect(transform.position({x: 1, y: 1})).toEqual({x: 11, y: -4});
    expect(transform.box({x: 0, y: 0, width: 5, height: 5})).toEqual({
      x: 10,
      y: -5,
      width: 5,
      height: 5,
    });
  });

  it('scales positions and boxes relative to the box', () => {
    const transform = scaleTransform(
      {x: 0, y: 0, width: 100, height: 100},
      {x: 100, y: 100, width: 200, height: 50},
    );
    expect(transform.position({x: 50, y: 50})).toEqual({x: 200, y: 125});
    expect(transform.box({x: 10, y: 10, width: 10, height: 10})).toEqual({
      x: 120,
      y: 105,
      width: 20,
      height: 5,
    });
  });

  it('does not scale an axis of a box without a size', () => {
    const transform = scaleTransform(
      {x: 0, y: 0, width: 0, height: 0},
      {x: 10, y: 10, width: 50, height: 50},
    );
    expect(transform.position({x: 0, y: 0})).toEqual({x: 10, y: 10});
    expect(transform.box({x: 0, y: 0, width: 4, height: 4})).toMatchObject({
      width: 4,
      height: 4,
    });
  });

  it('transforms the ends of a line', () => {
    expect(
      transformShapeGeometry(
        {position: {x: 0, y: 0}, endPosition: {x: 10, y: 10}},
        translateTransform({x: 1.111, y: 0}),
      ),
    ).toEqual({position: {x: 1.11, y: 0}, endPosition: {x: 11.11, y: 10}});
  });

  it('transforms the box of a shape', () => {
    expect(
      transformShapeGeometry(
        {position: {x: 0, y: 0}, width: 10, height: 10},
        scaleTransform(
          {x: 0, y: 0, width: 30, height: 30},
          {x: 0, y: 0, width: 10, height: 10},
        ),
      ),
    ).toEqual({position: {x: 0, y: 0}, width: 3.33, height: 3.33});
  });
});

describe('drawnShapeGeometry', () => {
  it('draws a box from one corner to another in any direction', () => {
    expect(
      drawnShapeGeometry('rectangle', {x: 100, y: 100}, {x: 50, y: 70}, false),
    ).toEqual({position: {x: 50, y: 70}, width: 50, height: 30});
  });

  it('makes a box square with shift towards the pointer', () => {
    expect(
      drawnShapeGeometry('circle', {x: 100, y: 100}, {x: 50, y: 120}, true),
    ).toEqual({position: {x: 50, y: 100}, width: 50, height: 50});
  });

  it('makes a square to the bottom right with shift when the pointer has not moved', () => {
    expect(
      drawnShapeGeometry('text', {x: 0, y: 0}, {x: 0, y: 0}, true),
    ).toEqual({position: {x: 0, y: 0}, width: 0, height: 0});
    expect(
      drawnShapeGeometry('group', {x: 0, y: 0}, {x: 0, y: 10}, true),
    ).toEqual({position: {x: 0, y: 0}, width: 10, height: 10});
  });

  it('draws a line to the pointer', () => {
    expect(
      drawnShapeGeometry('line', {x: 0, y: 0}, {x: 30, y: 10}, false),
    ).toEqual({position: {x: 0, y: 0}, endPosition: {x: 30, y: 10}});
  });

  it('makes a line horizontal or vertical with shift', () => {
    expect(
      drawnShapeGeometry('line', {x: 0, y: 0}, {x: 30, y: 10}, true),
    ).toEqual({position: {x: 0, y: 0}, endPosition: {x: 30, y: 0}});
    expect(
      drawnShapeGeometry('line', {x: 0, y: 0}, {x: 10, y: -30}, true),
    ).toEqual({position: {x: 0, y: 0}, endPosition: {x: 0, y: -30}});
  });
});
