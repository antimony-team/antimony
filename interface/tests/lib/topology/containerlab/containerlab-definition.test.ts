import {describe, expect, it} from 'vitest';

import {ContainerlabDefinition} from '@sb/lib/topology/containerlab/containerlab-definition';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';

const format = new ContainerlabFormat(() => null);

function read(source: string): ContainerlabDefinition {
  const definition = format.read(source);
  if (!definition) throw new Error('Invalid YAML');

  return definition;
}

const TOPOLOGY = `# The lab
name: lab
topology:
  nodes:
    # The first router
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
    client:
      kind: linux
  links:
    - endpoints: ["srl1:e1-1", "srl2:e1-1"]
    - endpoints: ["srl2:e1-2", "client:eth1"]
`;

describe('reading', () => {
  it('reads the name, the nodes and the links', () => {
    const definition = read(TOPOLOGY);

    expect(definition.name).toBe('lab');
    expect(definition.nodeNames).toEqual(['srl1', 'srl2', 'client']);
    expect([...definition.nodes.keys()]).toEqual(['srl1', 'srl2', 'client']);
    expect(definition.links.map(link => link.endpoints)).toEqual([
      [
        {node: 'srl1', interface: 'e1-1'},
        {node: 'srl2', interface: 'e1-1'},
      ],
      [
        {node: 'srl2', interface: 'e1-2'},
        {node: 'client', interface: 'eth1'},
      ],
    ]);
  });

  it('keeps the text as it was written', () => {
    expect(read(TOPOLOGY).toString()).toBe(TOPOLOGY);
  });

  it('has no name if the name is not a string', () => {
    expect(read('name: 42\n').name).toBeUndefined();
    expect(read('topology: {}\n').name).toBeUndefined();
  });

  it('reads an empty file as a topology without nodes and links', () => {
    const definition = read('');

    expect(definition.name).toBeUndefined();
    expect(definition.nodeNames).toEqual([]);
    expect(definition.nodes.size).toBe(0);
    expect(definition.links).toEqual([]);
  });

  it('reads nodes without a definition', () => {
    const definition = read('topology:\n  nodes:\n    a:\n    b: {}\n');

    expect(definition.nodeNames).toEqual(['a', 'b']);
    expect(definition.nodes.get('a')?.own()).toBeNull();
  });

  it('ignores links that are not a list', () => {
    expect(read('topology:\n  links: {a: b}\n').links).toEqual([]);
  });

  it('skips invalid links but keeps the positions of the others', () => {
    const definition = read(`topology:
  links:
    - endpoints: ["a:e1"]
    - endpoints: ["a:e2", "b:e2"]
`);

    expect(definition.links).toHaveLength(1);
    expect(definition.links[0].index).toBe(1);
  });

  it('finds the links of a node', () => {
    const links = read(TOPOLOGY).linksOf('srl2');

    expect(links.map(link => link.index)).toEqual([0, 1]);
    expect(read(TOPOLOGY).linksOf('client')[0].index).toBe(1);
    expect(read(TOPOLOGY).linksOf('missing')).toEqual([]);
  });

  it('resolves merge keys of YAML 1.1', () => {
    const definition = read(`topology:
  nodes:
    base: &base
      kind: linux
      image: alpine
    copy:
      <<: *base
      image: ubuntu
`);

    expect(definition.nodes.get('copy')?.get('kind')).toBe('linux');
    expect(definition.nodes.get('copy')?.get('image')).toBe('ubuntu');
  });
});

describe('templates', () => {
  it('is a template if it contains template actions', () => {
    expect(read('name: "{{ .Env.NAME }}"\n').isTemplate).toBe(true);
  });

  it('is a template even if the action is in a comment', () => {
    expect(read('# {{ range }}\nname: lab\n').isTemplate).toBe(true);
  });

  it('is no template without template actions', () => {
    expect(read(TOPOLOGY).isTemplate).toBe(false);
  });
});

describe('equality', () => {
  it('equals a definition with the same content but other formatting', () => {
    const a = read('name: lab\n');
    const b = read('name:   lab\n');

    expect(a.equals(b)).toBe(true);
  });

  it('does not equal a definition with other content', () => {
    expect(read('name: lab\n').equals(read('name: other\n'))).toBe(false);
  });
});

describe('editing', () => {
  it('returns a new definition and leaves the original as it is', () => {
    const original = read(TOPOLOGY);
    const edited = original.setName('other');

    expect(edited).not.toBe(original);
    expect(original.name).toBe('lab');
    expect(original.toString()).toBe(TOPOLOGY);
    expect(edited.name).toBe('other');
  });

  it('keeps comments when editing', () => {
    const edited = read(TOPOLOGY).setName('other');

    expect(edited.toString()).toContain('# The lab');
    expect(edited.toString()).toContain('# The first router');
  });

  it('adds a name to a topology without one', () => {
    expect(read('topology: {}\n').setName('lab').name).toBe('lab');
  });
});

describe('renaming nodes', () => {
  it('renames the node and the endpoints of its links', () => {
    const renamed = read(TOPOLOGY).renameNode('srl2', 'spine');

    expect(renamed.nodeNames).toEqual(['srl1', 'spine', 'client']);
    expect(renamed.links.map(link => link.endpoints)).toEqual([
      [
        {node: 'srl1', interface: 'e1-1'},
        {node: 'spine', interface: 'e1-1'},
      ],
      [
        {node: 'spine', interface: 'e1-2'},
        {node: 'client', interface: 'eth1'},
      ],
    ]);
  });

  it('keeps the comments of the renamed node', () => {
    const renamed = read(TOPOLOGY).renameNode('srl1', 'leaf');

    expect(renamed.toString()).toContain('# The first router\n    leaf:');
  });

  it('renames endpoints written as maps', () => {
    const renamed = read(`topology:
  nodes:
    a: {}
    b: {}
  links:
    - type: veth
      endpoints:
        - node: a
          interface: e1
        - node: b
          interface: e1
`).renameNode('a', 'c');

    expect(renamed.links[0].endpoints[0]).toEqual({node: 'c', interface: 'e1'});
    expect(renamed.links[0].endpoints[1]).toEqual({node: 'b', interface: 'e1'});
  });

  it('renames the single endpoint of a link to the host', () => {
    const renamed = read(`topology:
  nodes:
    a: {}
  links:
    - type: host
      endpoint:
        node: a
        interface: e1
      host-interface: veth0
`).renameNode('a', 'b');

    expect(renamed.links[0].endpoints).toEqual([{node: 'b', interface: 'e1'}]);
  });

  it('keeps nodes with a similar name alone', () => {
    const renamed = read(`topology:
  nodes:
    a: {}
    ab: {}
  links:
    - endpoints: ["ab:e1", "a:e1"]
`).renameNode('a', 'c');

    expect(renamed.links[0].endpoints).toEqual([
      {node: 'ab', interface: 'e1'},
      {node: 'c', interface: 'e1'},
    ]);
  });

  it('keeps interfaces that contain a colon', () => {
    const renamed = read(`topology:
  nodes:
    a: {}
    b: {}
  links:
    - endpoints: ["a:eth:1", "b:e1"]
`).renameNode('a', 'c');

    expect(renamed.links[0].endpoints[0]).toEqual({
      node: 'c',
      interface: 'eth:1',
    });
  });

  it('does nothing if the name stays the same', () => {
    const definition = read(TOPOLOGY);

    expect(definition.renameNode('srl1', 'srl1')).toBe(definition);
  });

  it('leaves the topology as it is if the node does not exist', () => {
    const renamed = read(TOPOLOGY).renameNode('missing', 'other');

    expect(renamed.nodeNames).toEqual(['srl1', 'srl2', 'client']);
    expect(renamed.equals(read(TOPOLOGY))).toBe(true);
  });
});

describe('renaming interfaces', () => {
  it('renames the interface of a brief endpoint', () => {
    const renamed = read(TOPOLOGY).renameInterface(1, 1, 'eth5');

    expect(renamed.links[1].endpoints[1]).toEqual({
      node: 'client',
      interface: 'eth5',
    });
    expect(renamed.links[1].endpoints[0]).toEqual({
      node: 'srl2',
      interface: 'e1-2',
    });
  });

  it('renames the interface of an endpoint written as a map', () => {
    const renamed = read(`topology:
  links:
    - type: veth
      endpoints:
        - node: a
          interface: e1
        - node: b
          interface: e1
`).renameInterface(0, 1, 'e9');

    expect(renamed.links[0].endpoints).toEqual([
      {node: 'a', interface: 'e1'},
      {node: 'b', interface: 'e9'},
    ]);
    expect(renamed.toString()).toContain('interface: e9');
  });

  it('only renames the first of two identical endpoints', () => {
    const renamed = read(`topology:
  links:
    - endpoints: ["a:e1", "a:e1"]
`).renameInterface(0, 1, 'e2');

    expect(renamed.links[0].endpoints).toEqual([
      {node: 'a', interface: 'e2'},
      {node: 'a', interface: 'e1'},
    ]);
  });

  it('does nothing for a link or an endpoint that does not exist', () => {
    const definition = read(TOPOLOGY);

    expect(definition.renameInterface(5, 0, 'e9')).toBe(definition);
    expect(definition.renameInterface(0, 3, 'e9')).toBe(definition);
  });
});

describe('connecting nodes', () => {
  it('adds a link in the brief form', () => {
    const connected = read(TOPOLOGY).connect([
      {node: 'srl1', interface: 'e1-2'},
      {node: 'client', interface: 'eth2'},
    ]);

    expect(connected.links).toHaveLength(3);
    expect(connected.links[2].notation).toBe('brief');
    expect(connected.links[2].endpoints).toEqual([
      {node: 'srl1', interface: 'e1-2'},
      {node: 'client', interface: 'eth2'},
    ]);
  });

  it('adds the links key to a topology without links', () => {
    const connected = read(
      'topology:\n  nodes:\n    a: {}\n    b: {}\n',
    ).connect([
      {node: 'a', interface: 'e1'},
      {node: 'b', interface: 'e1'},
    ]);

    expect(connected.links).toHaveLength(1);
    expect(connected.links[0].type).toBe('veth');
  });

  it('only connects two endpoints with interfaces', () => {
    const definition = read(TOPOLOGY);

    expect(definition.connect([{node: 'a', interface: 'e1'}])).toBe(definition);
    expect(
      definition.connect([
        {node: 'a', interface: 'e1'},
        {node: 'b', interface: 'e1'},
        {node: 'c', interface: 'e1'},
      ]),
    ).toBe(definition);
    expect(
      definition.connect([{node: 'a', interface: 'e1'}, {node: 'b'}]),
    ).toBe(definition);
  });
});

describe('deleting', () => {
  it('deletes nodes together with their links', () => {
    const deleted = read(TOPOLOGY).deleteNodes(['client']);

    expect(deleted.nodeNames).toEqual(['srl1', 'srl2']);
    expect(deleted.links.map(link => link.endpoints[0].node)).toEqual(['srl1']);
  });

  it('removes the links key when the last link is deleted', () => {
    const deleted = read(TOPOLOGY).deleteNodes(['srl2']);

    expect(deleted.links).toEqual([]);
    expect(deleted.toString()).not.toContain('links');
  });

  it('deletes links by their position', () => {
    const deleted = read(TOPOLOGY).deleteLinks([0]);

    expect(deleted.links).toHaveLength(1);
    expect(deleted.links[0].endpoints[1].node).toBe('client');
    expect(deleted.nodeNames).toEqual(['srl1', 'srl2', 'client']);
  });

  it('deletes several links in any order and with duplicates', () => {
    const deleted = read(`topology:
  links:
    - endpoints: ["a:e1", "b:e1"]
    - endpoints: ["a:e2", "b:e2"]
    - endpoints: ["a:e3", "b:e3"]
`).deleteLinks([0, 2, 0]);

    expect(deleted.links).toHaveLength(1);
    expect(deleted.links[0].endpoints[0].interface).toBe('e2');
  });

  it('removes the links key when all links are deleted', () => {
    const deleted = read(TOPOLOGY).deleteLinks([0, 1]);

    expect(deleted.toString()).not.toContain('links');
    expect(deleted.nodeNames).toEqual(['srl1', 'srl2', 'client']);
  });

  it('keeps a topology without links as it is when deleting links', () => {
    const deleted = read('topology:\n  nodes:\n    a: {}\n').deleteLinks([0]);

    expect(deleted.nodeNames).toEqual(['a']);
    expect(deleted.toString()).not.toContain('links');
  });

  it('deletes the links of a node to the host', () => {
    const deleted = read(`topology:
  nodes:
    a: {}
  links:
    - endpoints: ["a:e1", "host:veth0"]
`).deleteNodes(['a']);

    expect(deleted.toString()).not.toContain('links');
  });

  it('keeps invalid links that are not connected to a deleted node', () => {
    const deleted = read(`topology:
  nodes:
    a: {}
    b: {}
  links:
    - endpoints: ["a:e1"]
    - endpoints: ["a:e2", "b:e2"]
`).deleteNodes(['b']);

    expect(deleted.document.toJS()?.topology?.links).toEqual([
      {endpoints: ['a:e1']},
    ]);
  });
});

describe('adding nodes', () => {
  it('adds nodes with their definitions', () => {
    const added = read(TOPOLOGY).addNodes(
      [{name: 'srl3', definition: {kind: 'nokia_srlinux', image: 'srl'}}],
      [],
      new Map(),
    );

    expect(added.nodeNames).toEqual(['srl1', 'srl2', 'client', 'srl3']);
    expect(added.nodes.get('srl3')?.get('image')).toBe('srl');
    expect(added.links).toHaveLength(2);
  });

  it('adds nodes to an empty topology', () => {
    const added = read('').addNodes(
      [{name: 'a', definition: {kind: 'linux'}}],
      [],
      new Map(),
    );

    expect(added.nodeNames).toEqual(['a']);
    expect(added.toString()).not.toContain('links');
  });

  it('renames the endpoints of added links in the form they are written', () => {
    const added = read(TOPOLOGY).addNodes(
      [
        {name: 'srl1-1', definition: {kind: 'nokia_srlinux'}},
        {name: 'client-1', definition: {kind: 'linux'}},
      ],
      [
        {endpoints: ['srl1:e1-1', 'client:eth1']},
        {
          type: 'veth',
          endpoints: [
            {node: 'srl1', interface: 'e1-2'},
            {node: 'client', interface: 'eth2'},
          ],
        },
        {type: 'host', endpoint: {node: 'client', interface: 'eth3'}},
      ],
      new Map([
        ['srl1', 'srl1-1'],
        ['client', 'client-1'],
      ]),
    );

    expect(added.links.slice(2).map(link => link.endpoints)).toEqual([
      [
        {node: 'srl1-1', interface: 'e1-1'},
        {node: 'client-1', interface: 'eth1'},
      ],
      [
        {node: 'srl1-1', interface: 'e1-2'},
        {node: 'client-1', interface: 'eth2'},
      ],
      [{node: 'client-1', interface: 'eth3'}],
    ]);
    expect(added.links[2].notation).toBe('brief');
    expect(added.links[3].notation).toBe('extended');
  });

  it('keeps endpoints of nodes that are not renamed', () => {
    const added = read(TOPOLOGY).addNodes(
      [{name: 'b', definition: {}}],
      [{endpoints: ['b:e1', 'srl1:e1-5']}],
      new Map([['b', 'b']]),
    );

    expect(added.links[2].endpoints).toEqual([
      {node: 'b', interface: 'e1'},
      {node: 'srl1', interface: 'e1-5'},
    ]);
  });

  it('skips added links that are not maps', () => {
    const added = read(TOPOLOGY).addNodes([], ['a:e1', null, []], new Map());

    expect(added.document.toJS()?.topology?.links).toHaveLength(2);
  });
});

describe('node values', () => {
  const BASE = `topology:
  defaults:
    image: alpine
  nodes:
    base: &base
      kind: linux
      env:
        A: "1"
        B: "2"
    copy: *base
    plain:
      kind: linux
    empty:
`;

  it('writes a value into the node', () => {
    const edited = read(BASE).setNodeValue('plain', ['image'], 'ubuntu');

    expect(edited.nodes.get('plain')?.own(['image'])).toBe('ubuntu');
    expect(edited.nodes.get('plain')?.isInherited('image')).toBe(false);
  });

  it('writes a nested value into the node', () => {
    const edited = read(BASE).setNodeValue('plain', ['env', 'HOME'], '/root');

    expect(edited.nodes.get('plain')?.own(['env'])).toEqual({HOME: '/root'});
  });

  it('gives a node without a definition one of its own', () => {
    const edited = read(BASE).setNodeValue('empty', ['kind'], 'linux');

    expect(edited.nodes.get('empty')?.own()).toEqual({kind: 'linux'});
  });

  it('turns an alias into a map that merges the anchor', () => {
    const edited = read(BASE).setNodeValue('copy', ['image'], 'ubuntu');
    const copy = edited.nodes.get('copy');

    expect(edited.toString()).toContain('<<: *base');
    expect(copy?.get('kind')).toBe('linux');
    expect(copy?.get('image')).toBe('ubuntu');
    expect(edited.nodes.get('base')?.get('image')).toBe('alpine');
  });

  it('keeps the merged values of a map when setting a nested value', () => {
    const edited = read(BASE).setNodeValue('copy', ['env', 'C'], '3');

    expect(edited.nodes.get('copy')?.own(['env'])).toEqual({
      A: '1',
      B: '2',
      C: '3',
    });
    expect(edited.nodes.get('base')?.get('env')).toEqual({A: '1', B: '2'});
  });

  it('does nothing for an empty path', () => {
    const definition = read(BASE);

    expect(definition.setNodeValue('plain', [], 'x')).toBe(definition);
    expect(definition.resetNodeValue('plain', [])).toBe(definition);
  });

  it('creates the nodes key when setting a value in a topology without nodes', () => {
    const edited = read('name: lab\n').setNodeValue('a', ['kind'], 'linux');

    expect(edited.nodes.get('a')?.get('kind')).toBe('linux');
  });

  it('removes a value of the node', () => {
    const edited = read(BASE)
      .setNodeValue('plain', ['image'], 'ubuntu')
      .resetNodeValue('plain', ['image']);

    expect(edited.nodes.get('plain')?.get('image')).toBe('alpine');
    expect(edited.nodes.get('plain')?.isInherited('image')).toBe(true);
  });

  it('removes maps that are empty without the removed value', () => {
    const edited = read(BASE)
      .setNodeValue('plain', ['env', 'HOME'], '/root')
      .resetNodeValue('plain', ['env', 'HOME']);

    expect(edited.nodes.get('plain')?.own()).toEqual({kind: 'linux'});
  });

  it('keeps maps that still have other values', () => {
    const edited = read(BASE).resetNodeValue('base', ['env', 'A']);

    expect(edited.nodes.get('base')?.own(['env'])).toEqual({B: '2'});
  });

  it('does nothing for values the node does not set itself', () => {
    const definition = read(BASE);

    expect(definition.resetNodeValue('plain', ['image'])).toBe(definition);
    expect(definition.resetNodeValue('copy', ['kind'])).toBe(definition);
    expect(definition.resetNodeValue('missing', ['kind'])).toBe(definition);
    expect(definition.resetNodeValue('plain', ['kind', 'x'])).toBe(definition);
  });

  it('writes a node that only merges an anchor again as an alias', () => {
    const edited = read(BASE)
      .setNodeValue('copy', ['image'], 'ubuntu')
      .resetNodeValue('copy', ['image']);

    expect(edited.toString()).toContain('copy: *base');
    expect(edited.nodes.get('copy')?.get('kind')).toBe('linux');
  });

  it('names the merged definition after its anchors', () => {
    const definition = read(`topology:
  nodes:
    a: &a
      kind: linux
    b: &b
      image: alpine
    c:
      <<: [*a, *b]
      cmd: sh
    d: *a
`);

    expect(definition.nodes.get('c')?.sourcesOf('kind')).toEqual([
      {level: 'base', name: 'a, b'},
    ]);
    expect(definition.nodes.get('c')?.sourcesOf('cmd')).toEqual([
      {level: 'node'},
    ]);
    expect(definition.nodes.get('d')?.sourcesOf('kind')).toEqual([
      {level: 'base', name: 'a'},
    ]);
  });
});
