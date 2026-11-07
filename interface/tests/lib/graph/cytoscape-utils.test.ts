import cytoscape from 'cytoscape';
import {describe, expect, it} from 'vitest';

import {
  boundsToBox,
  fitGraph,
  generateGraph,
  generateGroups,
  generateLayerItems,
  getFitPadding,
  toGraphPosition,
  updateGrid,
  updateLayerTransform,
} from '@sb/lib/graph/cytoscape-utils';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {RunTopology} from '@sb/types/domain/topology';

const format = new ContainerlabFormat(() => null);

const topology: RunTopology = {
  definition: format.read(`name: lab
topology:
  nodes:
    a:
      kind: linux
    b: {}
    c: {}
  links:
    - endpoints: ["a:eth1", "b:eth1"]
    - endpoints: ["c:eth1", "host:veth0"]
`)!,
  annotations: {
    nodeAnnotations: [
      {id: 'a', position: {x: 0, y: 0}, icon: 'router', groupId: 'g'},
      {id: 'b', position: {x: 200, y: 0}},
    ],
    groupStyleAnnotations: [
      {
        id: 'g',
        name: 'Group',
        level: '1',
        position: {x: -50, y: -50},
        width: 100,
        height: 100,
        zIndex: 2,
      },
    ],
    freeShapeAnnotations: [
      {id: 's', shapeType: 'rectangle', position: {x: 0, y: 0}, zIndex: 1},
    ],
  },
};

const icons = {
  getNodeIcon: (icon?: string) => `icon:${icon ?? 'default'}`,
  getNodeShape: (icon?: string) => (icon ? 'ellipse' : 'rectangle'),
};

// Only the parts of the graph that the functions use
function fakeGraph(
  bounds: {x1: number; y1: number; w: number; h: number} | null,
  size = {width: 1000, height: 500},
) {
  const calls: {viewport?: unknown; animate?: unknown} = {};
  const cy = {
    elements: () => ({
      nonempty: () => bounds !== null,
      boundingBox: () => ({
        ...bounds!,
        x2: bounds!.x1 + bounds!.w,
        y2: bounds!.y1 + bounds!.h,
      }),
    }),
    width: () => size.width,
    height: () => size.height,
    minZoom: () => 0.1,
    maxZoom: () => 2,
    zoom: () => 2,
    pan: () => ({x: 10, y: 20}),
    container: () => ({getBoundingClientRect: () => ({left: 100, top: 50})}),
    viewport: (viewport: unknown) => (calls.viewport = viewport),
    animate: (animation: unknown) => (calls.animate = animation),
  };

  return {cy: cy as unknown as cytoscape.Core, calls};
}

function fakeElement() {
  const properties = new Map<string, string>();
  const style = {
    backgroundSize: '',
    backgroundPosition: '',
    transform: '',
    setProperty: (name: string, value: string) => properties.set(name, value),
    getPropertyValue: (name: string) => properties.get(name) ?? '',
  };

  return {
    element: {style} as unknown as HTMLElement,
    style,
    properties,
  };
}

describe('generateGraph', () => {
  const elements = generateGraph(topology, icons);

  it('creates a node for each node of the topology', () => {
    expect(
      elements.filter(element => element.classes === 'topology-node'),
    ).toHaveLength(3);
    expect(elements[0]).toEqual({
      data: {
        id: 'a',
        label: 'a',
        title: 'a',
        kind: 'linux',
        image: 'icon:router',
        shape: 'ellipse',
      },
      selectable: true,
      position: {x: 0, y: 0},
      classes: 'topology-node',
    });
  });

  it('places nodes that do not have a position', () => {
    const c = elements.find(element => element.data.id === 'c')!;
    expect(c.position).toBeDefined();
    expect(c.data.kind).toBe('');
  });

  it('creates edges only for links between two nodes', () => {
    const edges = elements.filter(element => element.classes === 'edge');
    expect(edges).toEqual([
      {
        data: {
          id: '0',
          source: 'a',
          target: 'b',
          title: 'a:eth1 <···> b:eth1',
          sourceLabel: 'eth1',
          targetLabel: 'eth1',
        },
        selectable: false,
        classes: 'edge',
      },
    ]);
  });
});

describe('generateGroups', () => {
  it('reads the groups with the members at their graph positions', () => {
    const groups = generateGroups(topology, generateGraph(topology, icons));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({id: 'g', memberIds: ['a'], shapeIds: []});
  });

  it('leaves out nodes that are not in the graph', () => {
    const groups = generateGroups(topology, []);
    expect(groups[0].memberIds).toEqual([]);
  });

  it('orders groups and shapes by their z-index', () => {
    const groups = generateGroups(topology, generateGraph(topology, icons));
    expect(generateLayerItems(topology, groups).map(item => item.id)).toEqual([
      's',
      'g',
    ]);
  });
});

describe('fitGraph', () => {
  it('uses a tenth of the smaller side as the padding', () => {
    expect(getFitPadding(fakeGraph(null).cy)).toBe(50);
  });

  it('converts the bounds of cytoscape to a box', () => {
    expect(boundsToBox({x1: 1, y1: 2, x2: 4, y2: 6, w: 3, h: 4})).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it('does nothing without elements or boxes', () => {
    const {cy, calls} = fakeGraph(null);
    fitGraph(cy, false);
    expect(calls).toEqual({});
  });

  it('centres the elements and boxes in the viewport', () => {
    const {cy, calls} = fakeGraph({x1: 0, y1: 0, w: 100, h: 100});
    fitGraph(cy, false, [{x: 100, y: 0, width: 100, height: 100}]);

    expect(calls.viewport).toEqual({zoom: 2, pan: {x: 300, y: 150}});
  });

  it('zooms out to fit large bounds and stops at the minimum zoom', () => {
    const fitted = fakeGraph({x1: 0, y1: 0, w: 1800, h: 100});
    fitGraph(fitted.cy, false);
    expect(fitted.calls.viewport).toMatchObject({zoom: 0.5});

    const limited = fakeGraph({x1: 0, y1: 0, w: 100000, h: 100});
    fitGraph(limited.cy, false);
    expect(limited.calls.viewport).toMatchObject({zoom: 0.1});
  });

  it('animates the viewport when asked to', () => {
    const {cy, calls} = fakeGraph(null);
    fitGraph(cy, true, [{x: 0, y: 0, width: 0, height: 0}]);
    expect(calls.animate).toEqual({zoom: 2, pan: {x: 500, y: 250}});
    expect(calls.viewport).toBeUndefined();
  });
});

describe('viewport helpers', () => {
  it('positions the grid dots on the multiples of the grid spacing', () => {
    const {element, style, properties} = fakeElement();
    updateGrid(element, fakeGraph(null).cy);

    expect(style.backgroundSize).toBe('70px 70px');
    expect(style.backgroundPosition).toBe('-25px -15px');
    expect(properties.get('--grid-dot-radius')).toBe('2.4px');
  });

  it('moves and scales a layer with the viewport', () => {
    const {element, style, properties} = fakeElement();
    updateLayerTransform(element, fakeGraph(null).cy);

    expect(style.transform).toBe('translate(10px, 20px) scale(2)');
    expect(properties.get('--sb-graph-zoom')).toBe('2');
  });

  it('converts a position on screen to the graph', () => {
    expect(toGraphPosition(fakeGraph(null).cy, 130, 90)).toEqual({
      x: 10,
      y: 10,
    });
  });
});
