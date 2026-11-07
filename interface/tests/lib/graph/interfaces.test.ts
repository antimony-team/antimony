import {describe, expect, it} from 'vitest';

import {
  interfaceName,
  matchInterface,
  nextInterface,
} from '@sb/lib/graph/interfaces';
import {InterfaceConfig} from '@sb/types/domain/device-info';
import {
  LinkEndpoint,
  TopologyDefinition,
} from '@sb/types/domain/topology-definition';

const srlinux: InterfaceConfig = {interfaces: [{pattern: 'e1-$', start: 1}]};

// MikroTik names the first interface ether2 or eth1
const mikrotik: InterfaceConfig = {
  interfaces: [
    {pattern: 'ether$', start: 2},
    {pattern: 'eth$', start: 1},
  ],
};

function createDefinition(links: LinkEndpoint[][]) {
  return {
    linksOf: (nodeName: string) =>
      links
        .filter(endpoints => endpoints.some(e => e.node === nodeName))
        .map(endpoints => ({endpoints})),
  } as unknown as TopologyDefinition;
}

describe('matchInterface', () => {
  it('returns the pattern and number of the interface', () => {
    expect(matchInterface('e1-12', srlinux)).toEqual({
      pattern: srlinux.interfaces[0],
      number: 12,
    });
  });

  it('tries the patterns in order', () => {
    expect(matchInterface('ether5', mikrotik)?.pattern.pattern).toBe('ether$');
    expect(matchInterface('eth5', mikrotik)?.pattern.pattern).toBe('eth$');
  });

  it('only matches whole names', () => {
    expect(matchInterface('e1-1x', srlinux)).toBeNull();
    expect(matchInterface('xe1-1', srlinux)).toBeNull();
    expect(matchInterface('e1-', srlinux)).toBeNull();
  });

  it('takes special characters in patterns literally', () => {
    const config = {interfaces: [{pattern: 'Gi0/0.$', start: 0}]};
    expect(matchInterface('Gi0/0.3', config)?.number).toBe(3);
    expect(matchInterface('Gi0/0x3', config)).toBeNull();
  });

  it('returns null without an interface', () => {
    expect(matchInterface(undefined, srlinux)).toBeNull();
    expect(matchInterface('', srlinux)).toBeNull();
  });
});

describe('interfaceName', () => {
  it('puts the number into the pattern', () => {
    expect(interfaceName(3, srlinux.interfaces[0])).toBe('e1-3');
    expect(interfaceName(3, {pattern: '$/$', start: 0})).toBe('3/3');
  });
});

describe('nextInterface', () => {
  it('starts at the start of the first pattern', () => {
    expect(nextInterface(createDefinition([]), 'srl1', srlinux)).toBe('e1-1');
    expect(nextInterface(createDefinition([]), 'mt1', mikrotik)).toBe('ether2');
  });

  it('fills the first gap', () => {
    const definition = createDefinition([
      [
        {node: 'srl1', interface: 'e1-1'},
        {node: 'srl2', interface: 'e1-1'},
      ],
      [
        {node: 'srl1', interface: 'e1-3'},
        {node: 'srl3', interface: 'e1-1'},
      ],
    ]);
    expect(nextInterface(definition, 'srl1', srlinux)).toBe('e1-2');
  });

  it('ignores the interfaces of other nodes', () => {
    const definition = createDefinition([
      [
        {node: 'srl1', interface: 'e1-1'},
        {node: 'srl2', interface: 'e1-2'},
      ],
    ]);
    expect(nextInterface(definition, 'srl2', srlinux)).toBe('e1-1');
  });

  it('counts interfaces of all patterns from their start', () => {
    const definition = createDefinition([
      [{node: 'mt1', interface: 'eth1'}],
      [{node: 'mt1', interface: 'ether3'}],
    ]);
    expect(nextInterface(definition, 'mt1', mikrotik)).toBe('ether4');
  });

  it('skips interfaces that are taken without a link', () => {
    expect(
      nextInterface(createDefinition([]), 'srl1', srlinux, ['e1-1', 'e1-2']),
    ).toBe('e1-3');
  });

  it('ignores interfaces that do not follow a pattern', () => {
    const definition = createDefinition([
      [{node: 'srl1', interface: 'mgmt0'}, {node: 'srl1'}],
    ]);
    expect(nextInterface(definition, 'srl1', srlinux)).toBe('e1-1');
  });
});
