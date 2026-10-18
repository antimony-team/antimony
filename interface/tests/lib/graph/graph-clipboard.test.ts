import {describe, expect, it} from 'vitest';

import {nodeBox} from '@sb/lib/graph/annotation-geometry';
import {
  clipboardBox,
  createClipboard,
  GraphClipboard,
  nextFreeName,
  parseClipboard,
  pasteClipboard,
} from '@sb/lib/graph/graph-clipboard';

const emptyContent = {nodes: [], links: [], groups: [], shapes: [], texts: []};

function clipboard(content: Partial<GraphClipboard> = {}): GraphClipboard {
  return createClipboard({...emptyContent, ...content});
}

describe('parseClipboard', () => {
  it('reads elements that were copied from a graph', () => {
    const copied = clipboard({links: [{endpoints: ['a:e1', 'b:e1']}]});
    expect(parseClipboard(JSON.stringify(copied))).toEqual(copied);
  });

  it('fills in missing lists', () => {
    expect(
      parseClipboard(JSON.stringify({marker: 'antimony/graph-elements'})),
    ).toEqual(clipboard());
  });

  it('ignores text that was not copied from a graph', () => {
    expect(parseClipboard('hello')).toBeNull();
    expect(parseClipboard('null')).toBeNull();
    expect(parseClipboard('{"nodes": []}')).toBeNull();
    expect(parseClipboard('{"marker": "other"}')).toBeNull();
  });
});

describe('clipboardBox', () => {
  it('returns null when nothing was copied', () => {
    expect(clipboardBox(clipboard())).toBeNull();
  });

  it('ignores nodes without a position', () => {
    expect(
      clipboardBox(
        clipboard({
          nodes: [{name: 'a', definition: {}, annotation: {id: 'a'}}],
        }),
      ),
    ).toBeNull();
  });

  it('returns the box around all copied elements', () => {
    expect(
      clipboardBox(
        clipboard({
          nodes: [
            {
              name: 'a',
              definition: {},
              annotation: {id: 'a', position: {x: 0, y: 0}},
            },
          ],
          groups: [
            {
              id: 'g',
              name: 'g',
              level: '1',
              position: {x: 100, y: 100},
              width: 50,
              height: 50,
            },
          ],
          shapes: [
            {
              id: 's',
              shapeType: 'line',
              position: {x: -100, y: 0},
              endPosition: {x: -50, y: 10},
            },
          ],
          texts: [{id: 't', text: '', position: {x: 0, y: 300}}],
        }),
      ),
    ).toEqual({x: -100, y: nodeBox({x: 0, y: 0}).y, width: 340, height: 392});
  });
});

describe('nextFreeName', () => {
  it('keeps a name that is not taken', () => {
    expect(nextFreeName('srl1', new Set(['srl2']))).toBe('srl1');
  });

  it('counts on from the number at the end of a taken name', () => {
    expect(nextFreeName('srl1', new Set(['srl1', 'srl2']))).toBe('srl3');
    expect(nextFreeName('node-9', new Set(['node-9']))).toBe('node-10');
  });

  it('appends a number to a taken name without one', () => {
    expect(nextFreeName('router', new Set(['router', 'router1']))).toBe(
      'router2',
    );
  });

  it('drops leading zeros of the number', () => {
    expect(nextFreeName('srl01', new Set(['srl01']))).toBe('srl2');
  });
});

describe('pasteClipboard', () => {
  const copied = clipboard({
    nodes: [
      {
        name: 'srl1',
        definition: {kind: 'nokia_srlinux'},
        annotation: {
          id: 'srl1',
          position: {x: 10, y: 10},
          groupId: 'group-1',
          icon: 'router',
        },
      },
      {
        name: 'srl2',
        definition: {},
        annotation: {id: 'srl2', groupId: 'not-copied'},
      },
    ],
    links: [{endpoints: ['srl1:e1-1', 'srl2:e1-1']}],
    groups: [
      {
        id: 'group-1',
        name: 'Core',
        level: '1',
        position: {x: 0, y: 0},
        width: 100,
        height: 100,
      },
      {
        id: 'nested',
        name: 'Nested',
        level: '1',
        position: {x: 5, y: 5},
        width: 10,
        height: 10,
        parentId: 'group-1',
      },
    ],
    shapes: [
      {id: 'shape-1', shapeType: 'rectangle', position: {x: 0, y: 0}},
      {
        id: 'shape-2',
        shapeType: 'line',
        position: {x: 0, y: 0},
        endPosition: {x: 10, y: 0},
        groupId: 'group-1',
      },
    ],
    texts: [{id: 'text-1', text: 'Hi', position: {x: 1, y: 1}}],
  });

  const pasted = pasteClipboard(
    copied,
    ['srl1', 'srl2', 'srl3'],
    {
      groupStyleAnnotations: [
        {
          id: 'group-1',
          name: 'g',
          level: '1',
          position: {x: 0, y: 0},
          width: 1,
          height: 1,
        },
      ],
      freeShapeAnnotations: [
        {id: 'shape-1', shapeType: 'circle', position: {x: 0, y: 0}},
      ],
    },
    {x: 20.123, y: -10},
  );

  it('renames nodes whose name is taken', () => {
    expect(pasted.names).toEqual(
      new Map([
        ['srl1', 'srl4'],
        ['srl2', 'srl5'],
      ]),
    );
    expect(pasted.nodes.map(node => [node.name, node.annotation.id])).toEqual([
      ['srl4', 'srl4'],
      ['srl5', 'srl5'],
    ]);
  });

  it('keeps the copied definitions and links', () => {
    expect(pasted.nodes[0].definition).toEqual({kind: 'nokia_srlinux'});
    expect(pasted.links).toBe(copied.links);
  });

  it('moves the elements by the distance and rounds their positions', () => {
    expect(pasted.nodes[0].annotation.position).toEqual({x: 30.12, y: 0});
    expect(pasted.nodes[1].annotation.position).toBeUndefined();
    expect(pasted.groups[0].position).toEqual({x: 20.12, y: -10});
    expect(pasted.texts[0].position).toEqual({x: 21.12, y: -9});
    expect(pasted.shapes[1]).toMatchObject({
      position: {x: 20.12, y: -10},
      endPosition: {x: 30.12, y: -10},
    });
  });

  it('writes the default size of shapes without one', () => {
    expect(pasted.shapes[0]).toMatchObject({width: 160, height: 100});
  });

  it('gives groups, shapes and texts new IDs', () => {
    expect(pasted.groups.map(group => group.id)).toEqual([
      'group-2',
      'group-3',
    ]);
    expect(pasted.shapes.map(shape => shape.id)).toEqual([
      'shape-2',
      'shape-3',
    ]);
    expect(pasted.texts.map(text => text.id)).toEqual(['text-1']);
  });

  it('keeps elements in a group only if it was copied with them', () => {
    expect(pasted.nodes[0].annotation.groupId).toBe('group-2');
    expect(pasted.nodes[1].annotation.groupId).toBeUndefined();
    expect(pasted.shapes[0].groupId).toBeUndefined();
    expect(pasted.shapes[1].groupId).toBe('group-2');
    expect(pasted.groups[0]).toMatchObject({
      parentId: undefined,
      groupId: undefined,
    });
    expect(pasted.groups[1]).toMatchObject({
      parentId: 'group-2',
      groupId: 'group-2',
    });
  });
});
