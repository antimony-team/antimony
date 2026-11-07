import {describe, expect, it} from 'vitest';

import {
  convertLatLngToXY,
  convertXYToLatLng,
  graphLinks,
  labelsToAnnotation,
  nodeAnnotationMap,
  nodeLayoutAnnotation,
  readGraphNodes,
  readNodeIcon,
} from '@sb/lib/graph/topology-graph';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';

const format = new ContainerlabFormat(() => null);

const definition = format.read(`name: lab
topology:
  kinds:
    nokia_srlinux:
      image: srl
  groups:
    spines:
      kind: nokia_srlinux
  nodes:
    a:
      kind: linux
      labels:
        graph-posX: "10"
        graph-posY: "20"
        graph-icon: router
        graph-group: core
        graph-level: 2
    b:
      group: spines
    c:
      labels:
        graph-geoCoordinateLat: "48.6848"
        graph-geoCoordinateLng: "9.0078"
    d: {}
  links:
    - endpoints: ["a:eth1", "b:e1-1"]
    - endpoints: ["a:eth2", "host:veth0"]
    - endpoints: ["c:eth1", "d:eth1"]
    - type: mgmt-net
      endpoint:
        node: d
        interface: eth2
`)!;

describe('geo coordinates', () => {
  it('maps the origin to the default coordinates', () => {
    expect(convertXYToLatLng(0, 0)).toEqual({lat: 48.6848, lng: 9.0078});
    expect(convertLatLngToXY(48.6848, 9.0078)).toEqual({x: 0, y: 0});
  });

  it('converts positions to coordinates and back', () => {
    const {lat, lng} = convertXYToLatLng(1234.5, -678.25);
    expect(convertLatLngToXY(lat, lng)).toEqual({x: 1234.5, y: -678.25});
  });

  it('puts positions further down further south', () => {
    expect(convertXYToLatLng(0, 3000).lat).toBeCloseTo(47.6848);
    expect(convertXYToLatLng(5000, 0).lng).toBeCloseTo(10.0078);
  });
});

describe('readGraphNodes', () => {
  it('reads the layout of the nodes from the graph labels', () => {
    expect(readGraphNodes(definition, {})).toEqual([
      {
        name: 'a',
        kind: 'linux',
        position: {x: 10, y: 20},
        icon: 'router',
        groupId: undefined,
        group: 'core',
        level: '2',
      },
      {
        name: 'b',
        kind: 'nokia_srlinux',
        position: null,
        icon: undefined,
        groupId: undefined,
        group: undefined,
        level: undefined,
      },
      {
        name: 'c',
        kind: undefined,
        position: {x: 0, y: 0},
        icon: undefined,
        groupId: undefined,
        group: undefined,
        level: undefined,
      },
      {
        name: 'd',
        kind: undefined,
        position: null,
        icon: undefined,
        groupId: undefined,
        group: undefined,
        level: undefined,
      },
    ]);
  });

  it('prefers the annotations over the graph labels', () => {
    const [a, , c, d] = readGraphNodes(definition, {
      nodeAnnotations: [
        {
          id: 'a',
          position: {x: 1, y: 2},
          icon: 'switch',
          group: 'edge',
          level: '1',
          groupId: 'g',
        },
        {id: 'c', geoCoordinates: {lat: 48.6848, lng: 9.2078}},
        {id: 'd', position: {x: 5, y: 5}, geoCoordinates: {lat: 0, lng: 0}},
      ],
    });

    expect(a).toMatchObject({
      position: {x: 1, y: 2},
      icon: 'switch',
      group: 'edge',
      level: '1',
      groupId: 'g',
    });
    expect(c.position).toEqual({x: 1000, y: 0});
    expect(d.position).toEqual({x: 5, y: 5});
  });
});

describe('graphLinks', () => {
  it('only returns links between two nodes of the topology', () => {
    expect(
      graphLinks(definition).map(link =>
        link.endpoints.map(endpoint => endpoint.node),
      ),
    ).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps the index of each link in the topology', () => {
    expect(graphLinks(definition).map(link => link.index)).toEqual([0, 2]);
  });
});

describe('node annotations', () => {
  it('prefers the icon of the annotation', () => {
    expect(readNodeIcon({'graph-icon': 'a'}, {id: 'n', icon: 'b'})).toBe('b');
    expect(readNodeIcon({'graph-icon': 'a'}, {id: 'n'})).toBe('a');
    expect(readNodeIcon(undefined, undefined)).toBeUndefined();
  });

  it('maps the annotations by node name', () => {
    expect(nodeAnnotationMap({}).size).toBe(0);
    expect(
      nodeAnnotationMap({nodeAnnotations: [{id: 'a'}, {id: 'b'}]}).get('b'),
    ).toEqual({id: 'b'});
  });

  it('stores the rounded position and the group of a layout', () => {
    expect(
      nodeLayoutAnnotation(
        {id: 'a', group: 'old', level: '1'},
        {position: {x: 1.234, y: 5.678}, groupId: null},
      ),
    ).toEqual({
      position: {x: 1.23, y: 5.68},
      geoCoordinates: undefined,
      groupId: undefined,
      group: undefined,
      level: undefined,
    });
  });

  it('keeps nodes that are placed by geo coordinates on coordinates', () => {
    expect(
      nodeLayoutAnnotation(
        {id: 'a', geoCoordinates: {lat: 0, lng: 0}},
        {position: {x: 1000, y: 0}, groupId: 'g'},
      ),
    ).toEqual({
      geoCoordinates: {lat: 48.6848, lng: expect.closeTo(9.2078, 10)},
      position: undefined,
      groupId: 'g',
      group: undefined,
      level: undefined,
    });
  });

  it('reads the layout from the graph labels', () => {
    expect(
      labelsToAnnotation({
        'graph-icon': 'router',
        'graph-group': 'core',
        'graph-level': 1,
        'graph-posX': '1.5',
        'graph-posY': '2',
        'graph-geoCoordinateLat': '48',
        'graph-geoCoordinateLng': '9',
      }),
    ).toEqual({
      icon: 'router',
      group: 'core',
      level: '1',
      position: {x: 1.5, y: 2},
      geoCoordinates: {lat: 48, lng: 9},
    });
  });

  it('ignores positions that are incomplete or not numbers', () => {
    const annotation = labelsToAnnotation({
      'graph-posX': '1',
      'graph-geoCoordinateLat': 'north',
      'graph-geoCoordinateLng': '9',
    });
    expect(annotation.position).toBeUndefined();
    expect(annotation.geoCoordinates).toBeUndefined();
  });
});
