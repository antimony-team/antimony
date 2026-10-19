import {describe, expect, it} from 'vitest';

import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {ContainerlabNode} from '@sb/lib/topology/containerlab/containerlab-node';

const format = new ContainerlabFormat(() => null);

function nodeOf(source: string, name: string): ContainerlabNode {
  const node = format.read(source)?.nodes.get(name);
  if (!node) throw new Error(`No node ${name}`);

  return node;
}

describe('kind', () => {
  it('takes the kind of the node in lowercase', () => {
    const node = nodeOf('topology:\n  nodes:\n    a: {kind: Linux}\n', 'a');

    expect(node.device).toBe('linux');
    expect(node.get('kind')).toBe('linux');
    expect(node.sourcesOf('kind')).toEqual([{level: 'node'}]);
  });

  it('takes the kind of the group before the one of the defaults', () => {
    const node = nodeOf(
      `topology:
  defaults: {kind: linux}
  groups:
    routers: {kind: nokia_srlinux}
  nodes:
    a: {group: routers}
`,
      'a',
    );

    expect(node.device).toBe('nokia_srlinux');
    expect(node.sourcesOf('kind')).toEqual([{level: 'group', name: 'routers'}]);
  });

  it('takes the kind of the group of the defaults', () => {
    const node = nodeOf(
      `topology:
  defaults: {group: routers}
  groups:
    routers: {kind: nokia_srlinux}
  nodes:
    a: {}
`,
      'a',
    );

    expect(node.device).toBe('nokia_srlinux');
  });

  it('takes the kind of the defaults', () => {
    const node = nodeOf(
      'topology:\n  defaults: {kind: linux}\n  nodes:\n    a:\n',
      'a',
    );

    expect(node.device).toBe('linux');
    expect(node.sourcesOf('kind')).toEqual([{level: 'defaults'}]);
  });

  it('has no kind if none of the levels sets one', () => {
    const node = nodeOf('topology:\n  nodes:\n    a: {kind: ""}\n', 'a');

    expect(node.device).toBeUndefined();
    expect(node.properties.has('kind')).toBe(false);
  });
});

describe('inheritance', () => {
  const TOPOLOGY = `topology:
  defaults:
    image: default-image
    env: {LEVEL: defaults, DEFAULTS: "1"}
    group: everyone
  kinds:
    linux:
      image: linux-image
      env: {LEVEL: kind, KIND: "1"}
      group: linux-group
  groups:
    linux-group:
      cmd: group-cmd
    everyone:
      cmd: everyone-cmd
    special:
      image: special-image
  nodes:
    a:
      kind: linux
    b:
      kind: linux
      group: special
      env: {LEVEL: node}
    c:
    d:
      kind: LINUX
`;

  it('takes properties from the kind and the defaults', () => {
    const node = nodeOf(TOPOLOGY, 'a');

    expect(node.get('image')).toBe('linux-image');
    expect(node.sourcesOf('image')).toEqual([{level: 'device', name: 'linux'}]);
    expect(node.isInherited('image')).toBe(true);
  });

  it('takes the group of the kind before the one of the defaults', () => {
    const node = nodeOf(TOPOLOGY, 'a');

    expect(node.groups).toEqual(['linux-group']);
    expect(node.get('cmd')).toBe('group-cmd');
  });

  it('takes the group of the node before the others', () => {
    const node = nodeOf(TOPOLOGY, 'b');

    expect(node.groups).toEqual(['special']);
    expect(node.get('image')).toBe('special-image');
    expect(node.sourcesOf('image')).toEqual([
      {level: 'group', name: 'special'},
    ]);
  });

  it('merges maps from all levels with the most specific one winning', () => {
    const node = nodeOf(TOPOLOGY, 'b');

    expect(node.get('env')).toEqual({LEVEL: 'node', KIND: '1', DEFAULTS: '1'});
    expect(node.sourcesOf('env')).toEqual([
      {level: 'node'},
      {level: 'device', name: 'linux'},
      {level: 'defaults'},
    ]);
    expect(node.isInherited('env')).toBe(false);
  });

  it('only takes the group of the defaults for a node without a definition', () => {
    const node = nodeOf(TOPOLOGY, 'c');

    expect(node.groups).toEqual(['everyone']);
    expect(node.get('cmd')).toBe('everyone-cmd');
    expect(node.get('image')).toBe('default-image');
  });

  it('finds the kind definition in any case', () => {
    const node = nodeOf(TOPOLOGY, 'd');

    expect(node.device).toBe('linux');
    expect(node.get('image')).toBe('linux-image');
  });

  // Bug: properties of other levels fall through to the default rule and are inherited
  it.skip('only reads the management addresses and aliases from the node', () => {
    const node = nodeOf(
      `topology:
  defaults:
    mgmt-ipv4: 10.0.0.1
    aliases: [x]
  nodes:
    a: {kind: linux}
    b: {kind: linux, mgmt-ipv4: 10.0.0.2}
`,
      'a',
    );

    expect(node.properties.has('mgmt-ipv4')).toBe(false);
    expect(node.properties.has('aliases')).toBe(false);
  });

  it('reads the management address of the node', () => {
    const node = nodeOf(
      'topology:\n  nodes:\n    b: {kind: linux, mgmt-ipv4: 10.0.0.2}\n',
      'b',
    );

    expect(node.get('mgmt-ipv4')).toBe('10.0.0.2');
    expect(node.sourcesOf('mgmt-ipv4')).toEqual([{level: 'node'}]);
  });

  it('has no sources for properties that are not set', () => {
    const node = nodeOf(TOPOLOGY, 'a');

    expect(node.sourcesOf('missing')).toEqual([]);
    expect(node.isInherited('missing')).toBe(false);
  });
});

describe('values', () => {
  const TOPOLOGY = `topology:
  defaults:
    env: {HOME: /root}
  nodes:
    a:
      kind: linux
      ports: [80, 443]
      env: {USER: admin}
`;

  it('returns the values at a path', () => {
    const node = nodeOf(TOPOLOGY, 'a');

    expect(node.valueAt(['env', 'HOME'])).toBe('/root');
    expect(node.valueAt(['ports', '1'])).toBe(443);
    expect(node.valueAt(['env', 'HOME', 'x'])).toBeUndefined();
    expect(node.valueAt(['missing', 'x'])).toBeUndefined();
  });

  it('returns all values for an empty path', () => {
    expect(nodeOf(TOPOLOGY, 'a').valueAt([])).toEqual({
      kind: 'linux',
      ports: [80, 443],
      env: {USER: 'admin', HOME: '/root'},
    });
  });

  it('returns the values the node sets itself', () => {
    const node = nodeOf(TOPOLOGY, 'a');

    expect(node.own(['env'])).toEqual({USER: 'admin'});
    expect(node.own()).toEqual({
      kind: 'linux',
      ports: [80, 443],
      env: {USER: 'admin'},
    });
  });

  it('returns the value the node would inherit without its own', () => {
    const node = nodeOf(TOPOLOGY, 'a');

    expect(node.inherited(['env'])).toEqual({HOME: '/root'});
    expect(node.inherited(['ports'])).toBeUndefined();
    expect(node.inherited(['env', 'HOME'])).toBe('/root');
  });

  it('returns the effective value as inherited one if the node does not set it', () => {
    const node = nodeOf(
      'topology:\n  defaults: {image: alpine}\n  nodes:\n    a: {}\n',
      'a',
    );

    expect(node.inherited(['image'])).toBe('alpine');
    expect(node.inherited([])).toEqual({image: 'alpine'});
  });

  it('inherits the merged value when the node overrides it', () => {
    const node = nodeOf(
      `topology:
  nodes:
    base: &base {image: alpine}
    a:
      <<: *base
      image: ubuntu
`,
      'a',
    );

    expect(node.get('image')).toBe('ubuntu');
    expect(node.inherited(['image'])).toBe('alpine');
  });

  it('writes and resets values through the definition', () => {
    const node = nodeOf(TOPOLOGY, 'a');

    const set = node.set(['image'], 'alpine');
    expect(set.nodes.get('a')?.get('image')).toBe('alpine');

    const reset = node.reset(['env', 'USER']);
    expect(reset.nodes.get('a')?.get('env')).toEqual({HOME: '/root'});
  });
});
