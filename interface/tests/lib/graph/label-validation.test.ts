import {describe, expect, it} from 'vitest';

import {
  validateInterfaceName,
  validateNodeName,
} from '@sb/lib/graph/label-validation';
import {TopologyLink} from '@sb/types/domain/topology-definition';

function createLink(
  index: number,
  endpoints: {node: string; interface?: string}[],
  type = 'veth',
): TopologyLink {
  return {
    index,
    type,
    endpoints,
    hostInterface: undefined,
    isBetweenNodes: endpoints.length > 1,
  };
}

describe('validateNodeName', () => {
  const nodeNames = ['srl1', 'srl2'];

  it('accepts new and unchanged names', () => {
    expect(validateNodeName('srl3', 'srl1', nodeNames)).toBeNull();
    expect(validateNodeName('srl1', 'srl1', nodeNames)).toBeNull();
  });

  it('rejects names of other nodes', () => {
    expect(validateNodeName('srl2', 'srl1', nodeNames)).toBe(
      'srl2 already exists',
    );
  });

  it('rejects empty names', () => {
    expect(validateNodeName('', 'srl1', nodeNames)).toBe(
      "The name can't be empty",
    );
  });

  it('rejects names with colons or whitespace', () => {
    expect(validateNodeName('srl:1', 'srl1', nodeNames)).toContain('“:”');
    expect(validateNodeName('srl 1', 'srl1', nodeNames)).toBe(
      "The name can't contain spaces",
    );
    expect(validateNodeName('srl\t1', 'srl1', nodeNames)).toBe(
      "The name can't contain spaces",
    );
  });
});

describe('validateInterfaceName', () => {
  const links = [
    createLink(0, [
      {node: 'srl1', interface: 'e1-1'},
      {node: 'srl2', interface: 'e1-1'},
    ]),
    createLink(1, [{node: 'srl1', interface: 'eth9'}], 'host'),
    createLink(2, [
      {node: 'srl1', interface: 'e1-2'},
      {node: 'srl3', interface: 'e1-1'},
    ]),
  ];

  it('accepts free interfaces', () => {
    expect(validateInterfaceName('e1-3', 'srl1', 2, links)).toBeNull();
  });

  it('accepts the interface the link already uses', () => {
    expect(validateInterfaceName('e1-2', 'srl1', 2, links)).toBeNull();
  });

  it('accepts interfaces that other nodes use', () => {
    expect(validateInterfaceName('e1-1', 'srl3', 2, links)).toBeNull();
  });

  it('names the node at the other end of the link that uses the interface', () => {
    expect(validateInterfaceName('e1-1', 'srl1', 2, links)).toBe(
      'e1-1 is already used by the link to srl2',
    );
  });

  it('names the type of links without another node', () => {
    expect(validateInterfaceName('eth9', 'srl1', 2, links)).toBe(
      'eth9 is already used by the link to host',
    );
  });

  it('rejects empty names and names with colons or whitespace', () => {
    expect(validateInterfaceName('', 'srl1', 2, links)).toBe(
      "The interface can't be empty",
    );
    expect(validateInterfaceName('e1:1', 'srl1', 2, links)).toContain('“:”');
    expect(validateInterfaceName('e1 1', 'srl1', 2, links)).toBe(
      "The name can't contain spaces",
    );
  });
});
