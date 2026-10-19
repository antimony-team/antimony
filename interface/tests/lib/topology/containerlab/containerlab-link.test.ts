import {describe, expect, it} from 'vitest';

import {ContainerlabLink} from '@sb/lib/topology/containerlab/containerlab-link';

describe('brief links', () => {
  it('reads a link between two nodes as veth link', () => {
    const link = ContainerlabLink.read({endpoints: ['a:e1-1', 'b:e1-2']}, 3);

    expect(link?.index).toBe(3);
    expect(link?.type).toBe('veth');
    expect(link?.notation).toBe('brief');
    expect(link?.endpoints).toEqual([
      {node: 'a', interface: 'e1-1'},
      {node: 'b', interface: 'e1-2'},
    ]);
    expect(link?.hostInterface).toBeUndefined();
    expect(link?.isBetweenNodes).toBe(true);
  });

  it('splits an endpoint at its first colon', () => {
    const link = ContainerlabLink.read({endpoints: ['a:eth:1', 'b:e1']}, 0);

    expect(link?.endpoints[0]).toEqual({node: 'a', interface: 'eth:1'});
  });

  it.each(['host', 'mgmt-net', 'macvlan', 'HOST'])(
    'reads a link to %s as a link of that type',
    hostNode => {
      const link = ContainerlabLink.read(
        {endpoints: [`${hostNode}:veth0`, 'a:e1']},
        0,
      );

      expect(link?.type).toBe(hostNode.toLowerCase());
      expect(link?.endpoints).toEqual([{node: 'a', interface: 'e1'}]);
      expect(link?.hostInterface).toBe('veth0');
      expect(link?.isBetweenNodes).toBe(false);
    },
  );

  it('takes the first host endpoint if both are hosts', () => {
    const link = ContainerlabLink.read(
      {endpoints: ['host:veth0', 'mgmt-net:veth1']},
      0,
    );

    expect(link?.type).toBe('host');
    expect(link?.endpoints).toEqual([{node: 'mgmt-net', interface: 'veth1'}]);
  });

  it.each([
    [['a:e1']],
    [['a:e1', 'b:e1', 'c:e1']],
    [['a:e1', 'b']],
    [['a:e1', ':e1']],
    [['a:e1', 'b:']],
    [['a:e1', 42]],
    ['a:e1'],
    [undefined],
  ])('does not read the endpoints %j', endpoints => {
    expect(ContainerlabLink.read({endpoints}, 0)).toBeNull();
  });

  it.each([null, undefined, 'a:e1', 42])('does not read the link %j', link => {
    expect(ContainerlabLink.read(link, 0)).toBeNull();
  });
});

describe('extended links', () => {
  it('reads a link with a type and endpoints as maps', () => {
    const link = ContainerlabLink.read(
      {
        type: ' VETH ',
        endpoints: [
          {node: 'a', interface: 'e1'},
          {node: 'b', interface: 'e2', mac: '00:00:00:00:00:01'},
        ],
      },
      1,
    );

    expect(link?.type).toBe('veth');
    expect(link?.notation).toBe('extended');
    expect(link?.endpoints).toEqual([
      {node: 'a', interface: 'e1'},
      {node: 'b', interface: 'e2'},
    ]);
  });

  it('reads a link with a single endpoint', () => {
    const link = ContainerlabLink.read(
      {
        type: 'host',
        endpoint: {node: 'a', interface: 'e1'},
        'host-interface': 'veth0',
      },
      0,
    );

    expect(link?.type).toBe('host');
    expect(link?.endpoints).toEqual([{node: 'a', interface: 'e1'}]);
    expect(link?.hostInterface).toBe('veth0');
    expect(link?.isBetweenNodes).toBe(false);
  });

  it('skips endpoints that are not complete', () => {
    const link = ContainerlabLink.read(
      {
        type: 'veth',
        endpoints: [{node: 'a'}, {node: 'b', interface: 'e1'}, 'c:e1', 'x'],
      },
      0,
    );

    expect(link?.endpoints).toEqual([
      {node: 'b', interface: 'e1'},
      {node: 'c', interface: 'e1'},
    ]);
  });

  it('reads a link with a type but no endpoints', () => {
    const link = ContainerlabLink.read({type: 'dummy'}, 0);

    expect(link?.type).toBe('dummy');
    expect(link?.endpoints).toEqual([]);
    expect(link?.hostInterface).toBeUndefined();
  });

  it('ignores a host interface that is not a string', () => {
    const link = ContainerlabLink.read(
      {type: 'host', endpoint: 'a:e1', 'host-interface': 5},
      0,
    );

    expect(link?.hostInterface).toBeUndefined();
  });

  it('reads a link with an empty type as brief link', () => {
    const link = ContainerlabLink.read(
      {type: '  ', endpoints: ['a:e1', 'b:e1']},
      0,
    );

    expect(link?.notation).toBe('brief');
    expect(link?.type).toBe('veth');
  });
});
