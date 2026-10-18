import {describe, expect, it} from 'vitest';

import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {createTopologyTemplate} from '@sb/lib/topology-template';

describe('createTopologyTemplate', () => {
  it('connects two SR Linux nodes in a topology with the given name', () => {
    const {definition} = createTopologyTemplate('my-lab');
    const topology = new ContainerlabFormat(() => null).read(definition!);

    expect(topology?.name).toBe('my-lab');
    expect(topology?.nodeNames).toEqual(['srl1', 'srl2']);
    expect(topology?.nodes.get('srl1')?.device).toBe('nokia_srlinux');
    expect(topology?.links.map(link => link.endpoints)).toEqual([
      [
        {node: 'srl1', interface: 'e1-1'},
        {node: 'srl2', interface: 'e1-1'},
      ],
    ]);
  });

  it('places both nodes as routers', () => {
    const {annotations} = createTopologyTemplate('lab');

    expect(JSON.parse(annotations!)).toEqual({
      nodeAnnotations: [
        {id: 'srl1', position: {x: -100, y: 0}, icon: 'router'},
        {id: 'srl2', position: {x: 100, y: -160}, icon: 'router'},
      ],
    });
  });

  it('quotes names that YAML would read otherwise', () => {
    const {definition} = createTopologyTemplate('123');

    expect(new ContainerlabFormat(() => null).read(definition!)?.name).toBe(
      '123',
    );
  });
});
