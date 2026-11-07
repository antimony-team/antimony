import {describe, expect, it} from 'vitest';

import {groupBoxAround} from '@sb/lib/graph/annotation-geometry';
import {
  addAnnotationItem,
  convertGraphLabels,
  convertLegacyGroups,
  findNodeAnnotation,
  frontZIndex,
  groupParentUpdate,
  nextAnnotationId,
  removeAnnotationItems,
  removeGroupAnnotations,
  removeNodeAnnotations,
  removeOrphanedNodeAnnotations,
  renameNodeAnnotation,
  reorderAnnotationItems,
  stepLayerItems,
  updateAnnotationItems,
  updateNodeAnnotations,
} from '@sb/lib/graph/topology-annotations';
import {convertLatLngToXY} from '@sb/lib/graph/topology-graph';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {
  FreeShapeAnnotation,
  GroupStyleAnnotation,
  TopologyAnnotations,
} from '@sb/types/domain/topology';

const format = new ContainerlabFormat(() => null);

function definition(source: string) {
  return format.read(source)!;
}

function group(
  id: string,
  fields: Partial<GroupStyleAnnotation> = {},
): GroupStyleAnnotation {
  return {
    id,
    name: id,
    level: '1',
    position: {x: 0, y: 0},
    width: 100,
    height: 100,
    ...fields,
  };
}

function shape(
  id: string,
  fields: Partial<FreeShapeAnnotation> = {},
): FreeShapeAnnotation {
  return {
    id,
    shapeType: 'rectangle',
    position: {x: 0, y: 0},
    width: 100,
    height: 100,
    ...fields,
  };
}

function zIndices(annotations: TopologyAnnotations) {
  return Object.fromEntries(
    [
      ...(annotations.groupStyleAnnotations ?? []),
      ...(annotations.freeShapeAnnotations ?? []),
      ...(annotations.freeTextAnnotations ?? []),
    ].map(item => [item.id, item.zIndex]),
  );
}

describe('node annotations', () => {
  const annotations: TopologyAnnotations = {
    nodeAnnotations: [
      {id: 'a', position: {x: 1, y: 2}, icon: 'router'},
      {id: 'b', groupId: 'g'},
    ],
  };

  it('finds the annotation of a node by its name', () => {
    expect(findNodeAnnotation(annotations, 'b')).toEqual({
      id: 'b',
      groupId: 'g',
    });
    expect(findNodeAnnotation(annotations, 'c')).toBeUndefined();
    expect(findNodeAnnotation({}, 'a')).toBeUndefined();
  });

  it('merges updates and removes fields that are set to undefined', () => {
    const updated = updateNodeAnnotations(
      annotations,
      new Map([['a', {icon: undefined, groupId: 'g'}]]),
    );

    expect(updated.nodeAnnotations![0]).toEqual({
      id: 'a',
      position: {x: 1, y: 2},
      groupId: 'g',
    });
    expect('icon' in updated.nodeAnnotations![0]).toBe(false);
  });

  it('adds annotations for nodes that do not have one', () => {
    const updated = updateNodeAnnotations(
      {},
      new Map([['c', {position: {x: 0, y: 0}, icon: undefined}]]),
    );
    expect(updated.nodeAnnotations).toEqual([
      {id: 'c', position: {x: 0, y: 0}},
    ]);
  });

  it('leaves the given annotations untouched', () => {
    const copy = structuredClone(annotations);
    updateNodeAnnotations(annotations, new Map([['a', {icon: undefined}]]));
    renameNodeAnnotation(annotations, 'a', 'z');
    removeNodeAnnotations(annotations, ['a']);
    expect(annotations).toEqual(copy);
  });

  it('renames the annotation of a node', () => {
    expect(
      renameNodeAnnotation(annotations, 'a', 'z').nodeAnnotations!.map(
        annotation => annotation.id,
      ),
    ).toEqual(['z', 'b']);
  });

  it('returns annotations without node annotations as they are', () => {
    const empty = {freeTextAnnotations: []};
    expect(renameNodeAnnotation(empty, 'a', 'b')).toBe(empty);
    expect(removeNodeAnnotations(empty, ['a'])).toBe(empty);
  });

  it('removes the annotations of the given nodes', () => {
    expect(
      removeNodeAnnotations(annotations, ['a', 'missing']).nodeAnnotations,
    ).toEqual([{id: 'b', groupId: 'g'}]);
  });

  it('removes the annotations of nodes that are not in the definition', () => {
    const def = definition('name: lab\ntopology:\n  nodes:\n    b: {}\n');
    expect(
      removeOrphanedNodeAnnotations(def, annotations).nodeAnnotations,
    ).toEqual([{id: 'b', groupId: 'g'}]);
  });

  it('returns the same annotations when no annotation is orphaned', () => {
    const def = definition(
      'name: lab\ntopology:\n  nodes:\n    a: {}\n    b: {}\n',
    );
    expect(removeOrphanedNodeAnnotations(def, annotations)).toBe(annotations);
  });
});

describe('annotation items', () => {
  it('returns the first free ID with the prefix', () => {
    const annotations = {
      freeShapeAnnotations: [shape('shape-1'), shape('shape-3')],
    };
    expect(nextAnnotationId(annotations, 'freeShapeAnnotations', 'shape')).toBe(
      'shape-2',
    );
    expect(nextAnnotationId({}, 'freeTextAnnotations', 'text')).toBe('text-1');
  });

  it('adds an item to a list that does not exist yet', () => {
    expect(
      addAnnotationItem({}, 'freeShapeAnnotations', shape('s'))
        .freeShapeAnnotations,
    ).toEqual([shape('s')]);
  });

  it('updates items by their ID and removes undefined fields', () => {
    const updated = updateAnnotationItems(
      {freeShapeAnnotations: [shape('a', {zIndex: 1}), shape('b')]},
      'freeShapeAnnotations',
      new Map([['a', {zIndex: undefined, width: 5}]]),
    );
    expect(updated.freeShapeAnnotations).toEqual([
      shape('a', {width: 5}),
      shape('b'),
    ]);
  });

  it('returns the annotations as they are when the list does not exist', () => {
    const annotations = {};
    expect(
      updateAnnotationItems(
        annotations,
        'freeShapeAnnotations',
        new Map([['a', {width: 5}]]),
      ),
    ).toBe(annotations);
    expect(
      removeAnnotationItems(annotations, 'freeShapeAnnotations', ['a']),
    ).toBe(annotations);
  });

  it('removes items by their ID', () => {
    expect(
      removeAnnotationItems(
        {freeShapeAnnotations: [shape('a'), shape('b')]},
        'freeShapeAnnotations',
        ['a'],
      ).freeShapeAnnotations,
    ).toEqual([shape('b')]);
  });

  it('returns a z-index in front of all items of the lists', () => {
    const annotations = {
      freeShapeAnnotations: [shape('a', {zIndex: 4}), shape('b')],
      groupStyleAnnotations: [group('g', {zIndex: 9})],
    };
    expect(frontZIndex(annotations, ['freeShapeAnnotations'])).toBe(5);
    expect(
      frontZIndex(annotations, [
        'freeShapeAnnotations',
        'groupStyleAnnotations',
      ]),
    ).toBe(10);
    expect(frontZIndex({}, ['freeShapeAnnotations'])).toBe(1);
  });
});

describe('reorderAnnotationItems', () => {
  const annotations: TopologyAnnotations = {
    freeShapeAnnotations: [
      shape('a', {zIndex: 2}),
      shape('b', {zIndex: 1}),
      shape('c', {zIndex: 3}),
    ],
    groupStyleAnnotations: [group('g', {zIndex: 5})],
  };
  const keys = ['freeShapeAnnotations', 'groupStyleAnnotations'] as const;

  it('brings items to the front and keeps their order', () => {
    expect(
      zIndices(
        reorderAnnotationItems(annotations, [...keys], ['a', 'b'], true),
      ),
    ).toEqual({a: 7, b: 6, c: 3, g: 5});
  });

  it('sends items to the back and keeps their order', () => {
    expect(
      zIndices(
        reorderAnnotationItems(annotations, [...keys], ['g', 'c'], false),
      ),
    ).toEqual({a: 2, b: 1, c: -2, g: -1});
  });

  it('returns the annotations as they are when no item is moved', () => {
    expect(
      reorderAnnotationItems(annotations, [...keys], ['missing'], true),
    ).toBe(annotations);
  });
});

describe('stepLayerItems', () => {
  it('moves an item forward past the next item it overlaps', () => {
    const annotations = {
      freeShapeAnnotations: [
        shape('a', {zIndex: 1}),
        shape('far', {zIndex: 2, position: {x: 1000, y: 1000}}),
        shape('b', {zIndex: 3}),
      ],
    };
    expect(zIndices(stepLayerItems(annotations, ['a'], true))).toEqual({
      far: 1,
      b: 2,
      a: 3,
    });
  });

  it('moves an item backward past the previous item it overlaps', () => {
    const annotations = {
      freeShapeAnnotations: [shape('a', {zIndex: 1}), shape('b', {zIndex: 2})],
    };
    expect(zIndices(stepLayerItems(annotations, ['b'], false))).toEqual({
      a: 2,
      b: 1,
    });
  });

  it('does not move an item that is already at the front', () => {
    const annotations = {
      freeShapeAnnotations: [shape('a', {zIndex: 1}), shape('b', {zIndex: 2})],
    };
    expect(zIndices(stepLayerItems(annotations, ['b'], true))).toEqual({
      a: 1,
      b: 2,
    });
  });

  it('gives items with equal z-indices distinct ones in the new order', () => {
    const annotations = {
      freeShapeAnnotations: [shape('a'), shape('b'), shape('c')],
    };
    expect(zIndices(stepLayerItems(annotations, ['a'], true))).toEqual({
      b: undefined,
      a: 1,
      c: 2,
    });
  });

  it('only reorders the items of the same group', () => {
    const annotations = {
      groupStyleAnnotations: [group('g', {zIndex: 0})],
      freeShapeAnnotations: [
        shape('inside', {groupId: 'g', zIndex: 1}),
        shape('outside', {zIndex: 2}),
      ],
    };
    expect(zIndices(stepLayerItems(annotations, ['inside'], true))).toEqual({
      g: 0,
      inside: 1,
      outside: 2,
    });
  });
});

describe('removeGroupAnnotations', () => {
  const annotations: TopologyAnnotations = {
    groupStyleAnnotations: [
      group('outer'),
      group('middle', {parentId: 'outer'}),
      group('inner', {parentId: 'middle', groupId: 'middle'}),
      group('other'),
    ],
    nodeAnnotations: [
      {id: 'n1', groupId: 'middle', group: 'legacy', level: '1'},
      {id: 'n2', groupId: 'other'},
      {id: 'n3'},
    ],
    freeShapeAnnotations: [shape('s1', {groupId: 'middle'})],
    freeTextAnnotations: [
      {id: 't1', text: '', position: {x: 0, y: 0}, groupId: 'middle'},
    ],
  };

  it('moves the contents of a removed group to its parent', () => {
    const result = removeGroupAnnotations(annotations, ['middle']);

    expect(result.groupStyleAnnotations!.map(item => item.id)).toEqual([
      'outer',
      'inner',
      'other',
    ]);
    expect(result.groupStyleAnnotations![1]).toMatchObject({
      parentId: 'outer',
      groupId: 'outer',
    });
    expect(result.nodeAnnotations).toEqual([
      {id: 'n1', groupId: 'outer'},
      {id: 'n2', groupId: 'other'},
      {id: 'n3'},
    ]);
    expect(result.freeShapeAnnotations![0].groupId).toBe('outer');
    expect(result.freeTextAnnotations![0].groupId).toBe('outer');
  });

  it('moves the contents out of all groups when the parents are removed as well', () => {
    const result = removeGroupAnnotations(annotations, ['outer', 'middle']);

    expect(result.nodeAnnotations![0]).toEqual({id: 'n1'});
    expect(result.freeShapeAnnotations![0]).not.toHaveProperty('groupId');
    const inner = result.groupStyleAnnotations!.find(
      item => item.id === 'inner',
    )!;
    expect(inner).not.toHaveProperty('parentId');
    expect(inner).not.toHaveProperty('groupId');
  });

  it('handles groups that are nested in each other', () => {
    const result = removeGroupAnnotations(
      {
        groupStyleAnnotations: [
          group('a', {parentId: 'b'}),
          group('b', {parentId: 'a'}),
        ],
        nodeAnnotations: [{id: 'n', groupId: 'a'}],
      },
      ['a', 'b'],
    );
    expect(result).toEqual({
      groupStyleAnnotations: [],
      nodeAnnotations: [{id: 'n'}],
    });
  });

  it('builds the parent fields of a group', () => {
    expect(groupParentUpdate('g')).toEqual({parentId: 'g', groupId: 'g'});
    expect(groupParentUpdate(null)).toEqual({
      parentId: undefined,
      groupId: undefined,
    });
  });
});

describe('convertGraphLabels', () => {
  it('returns null when no node has graph labels', () => {
    const def = definition(
      'name: lab\ntopology:\n  nodes:\n    a:\n      labels:\n        role: core\n',
    );
    expect(convertGraphLabels(def, {})).toBeNull();
  });

  it('moves the graph labels to the annotations', () => {
    const def = definition(`name: lab
topology:
  nodes:
    a:
      kind: linux
      labels:
        graph-posX: "10"
        graph-posY: "20.5"
        graph-icon: router
        graph-group: core
        graph-level: 2
        role: core
    b:
      labels:
        graph-geoCoordinateLat: "48.1"
        graph-geoCoordinateLng: "9.1"
`);
    const result = convertGraphLabels(def, {})!;

    expect(result.annotations.nodeAnnotations).toEqual([
      {
        id: 'a',
        position: {x: 10, y: 20.5},
        icon: 'router',
        group: 'core',
        level: '2',
      },
      {id: 'b', geoCoordinates: {lat: 48.1, lng: 9.1}},
    ]);
    expect(result.definition.nodes.get('a')!.own(['labels'])).toEqual({
      role: 'core',
    });
    expect(result.definition.toString()).not.toContain('graph-');
  });

  it('keeps the fields that are already set in an annotation', () => {
    const def = definition(`name: lab
topology:
  nodes:
    a:
      labels:
        graph-posX: "10"
        graph-posY: "20"
        graph-icon: router
`);
    const result = convertGraphLabels(def, {
      nodeAnnotations: [{id: 'a', position: {x: 1, y: 1}}],
    })!;
    expect(result.annotations.nodeAnnotations).toEqual([
      {id: 'a', position: {x: 1, y: 1}, icon: 'router'},
    ]);
  });
});

describe('convertLegacyGroups', () => {
  it('returns null when no node uses the legacy fields', () => {
    expect(
      convertLegacyGroups({nodeAnnotations: [{id: 'a', groupId: 'g'}]}),
    ).toBeNull();
  });

  it('adds a group around the members of a legacy group', () => {
    const result = convertLegacyGroups({
      nodeAnnotations: [
        {id: 'a', group: 'core', level: '1', position: {x: 0, y: 0}},
        {id: 'b', group: 'core', level: '1', position: {x: 100, y: 0}},
      ],
    })!;
    const box = groupBoxAround([
      {x: 0, y: 0},
      {x: 100, y: 0},
    ])!;

    expect(result.nodeAnnotations).toEqual([
      {id: 'a', groupId: 'core:1', position: {x: 0, y: 0}},
      {id: 'b', groupId: 'core:1', position: {x: 100, y: 0}},
    ]);
    expect(result.groupStyleAnnotations).toEqual([
      {
        id: 'core:1',
        name: 'core',
        level: '1',
        position: {x: box.x, y: box.y},
        width: box.width,
        height: box.height,
      },
    ]);
  });

  it('uses the geo coordinates of members without a position', () => {
    const result = convertLegacyGroups({
      nodeAnnotations: [
        {id: 'a', group: 'edge', geoCoordinates: {lat: 48, lng: 9}},
      ],
    })!;
    const box = groupBoxAround([convertLatLngToXY(48, 9)])!;

    expect(result.groupStyleAnnotations![0]).toMatchObject({
      id: 'edge',
      level: '1',
      position: {x: box.x, y: box.y},
    });
  });

  it('does not add a group for members without a position', () => {
    const result = convertLegacyGroups({
      nodeAnnotations: [{id: 'a', group: 'edge'}],
    })!;
    expect(result.nodeAnnotations).toEqual([{id: 'a', groupId: 'edge'}]);
    expect(result.groupStyleAnnotations).toBeUndefined();
  });

  it('moves members of existing groups to the group ID', () => {
    const result = convertLegacyGroups({
      groupStyleAnnotations: [group('g1', {name: 'Core'})],
      nodeAnnotations: [{id: 'a', group: 'Core', position: {x: 0, y: 0}}],
    })!;
    expect(result.nodeAnnotations).toEqual([
      {id: 'a', groupId: 'g1', position: {x: 0, y: 0}},
    ]);
    expect(result.groupStyleAnnotations).toHaveLength(1);
  });

  it('removes a level that has no group', () => {
    const result = convertLegacyGroups({
      nodeAnnotations: [{id: 'a', level: '2'}],
    })!;
    expect(result.nodeAnnotations).toEqual([{id: 'a'}]);
  });
});
