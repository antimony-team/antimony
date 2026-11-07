#!/usr/bin/env python3
"""
Fills a development server with a few collections and topologies of Alpine nodes, each with its own layout. The
topologies in "Showcase" also have groups, shapes, lines and texts, for screenshots.

Collections and topologies that already exist are skipped, so the script can run more than once.

    python3 scripts/seed-dev.py [--url http://localhost:3100] [--username admin] [--password admin]
"""

import argparse
import http.cookiejar
import json
import math
import re
import sys
import urllib.error
import urllib.request

IMAGE = 'alpine:3.22'

TEAL, BLUE, AMBER, RED, VIOLET, GREY = '#3fcfad', '#5b8def', '#f5a524', '#e5484d', '#a78bfa', '#c7c8cc'


def line(names, x=0, y=0, gap=200):
    return {name: (x + i * gap, y) for i, name in enumerate(names)}


def ring(names, radius=260):
    step = 2 * math.pi / len(names)
    return {name: (round(radius * math.cos(i * step - math.pi / 2)), round(radius * math.sin(i * step - math.pi / 2)))
            for i, name in enumerate(names)}


def star(center, names, radius=240):
    return {center: (0, 0), **ring(names, radius)}


def tiers(*rows, gap_x=180, gap_y=200):
    positions = {}
    for row, names in enumerate(rows):
        offset = -(len(names) - 1) * gap_x / 2
        positions.update({name: (round(offset + i * gap_x), row * gap_y) for i, name in enumerate(names)})
    return positions


def chain(names):
    return list(zip(names, names[1:]))


def full_mesh(names):
    return [(a, b) for i, a in enumerate(names) for b in names[i + 1:]]


def rectangle(x, y, width, height, color, opacity=0.08, style='dashed', radius=12):
    return {'shapeType': 'rectangle', 'position': {'x': x, 'y': y}, 'width': width, 'height': height,
            'fillColor': color, 'fillOpacity': opacity, 'borderColor': color, 'borderWidth': 1.5,
            'borderStyle': style, 'cornerRadius': radius, 'zIndex': -1}


def circle(x, y, diameter, color, opacity=0.06, style='dashed'):
    return {'shapeType': 'circle', 'position': {'x': x, 'y': y}, 'width': diameter, 'height': diameter,
            'fillColor': color, 'fillOpacity': opacity, 'borderColor': color, 'borderWidth': 1.5,
            'borderStyle': style, 'zIndex': -1}


def arrow(start, end, color, style='solid', start_arrow=False, end_arrow=True, width=2):
    return {'shapeType': 'line', 'position': {'x': start[0], 'y': start[1]}, 'endPosition': {'x': end[0], 'y': end[1]},
            'borderColor': color, 'borderWidth': width, 'borderStyle': style, 'lineStartArrow': start_arrow,
            'lineEndArrow': end_arrow, 'zIndex': 1}


def text(x, y, content, size=14, color='#ffffff', width=None, align='left'):
    annotation = {'text': content, 'position': {'x': x, 'y': y}, 'fontSize': size, 'fontColor': color,
                  'textAlign': align, 'zIndex': 2}
    if width:
        annotation['width'] = width
    return annotation


def group_box(members, positions, padding):
    """Returns the box the editor draws around the members of a group, with some extra padding."""
    xs = [positions[m][0] for m in members]
    ys = [positions[m][1] for m in members]
    x, y = min(xs) - 56 - padding, min(ys) - 70 - padding
    return x, y, max(xs) + 56 + padding - x, max(ys) + 81 + padding - y


def topology(name, positions, links, icons=None, groups=None, shapes=(), texts=()):
    """
    Returns the definition and the annotations of a topology. Groups are given as
    {id: (label, members, color[, padding])}, shapes and texts as the annotations they become.
    """
    icons = icons or {}
    ports = {}

    def endpoint(node):
        ports[node] = ports.get(node, 0) + 1
        return f'{node}:eth{ports[node]}'

    definition = f'name: {name}\n\ntopology:\n  nodes:\n'
    for node in positions:
        definition += f'    {node}:\n      kind: linux\n      image: {IMAGE}\n'
    definition += '\n  links:\n'
    for a, b in links:
        definition += f'    - endpoints: ["{endpoint(a)}", "{endpoint(b)}"]\n'

    node_annotations = []
    for node, (x, y) in positions.items():
        annotation = {'id': node, 'position': {'x': x, 'y': y}}
        if node in icons:
            annotation['icon'] = icons[node]
        node_annotations.append(annotation)

    group_annotations = []
    for group_id, (label, members, color, *padding) in (groups or {}).items():
        x, y, width, height = group_box(members, positions, padding[0] if padding else 12)
        group_annotations.append({
            'id': group_id, 'name': label, 'level': '1', 'position': {'x': x, 'y': y}, 'width': width,
            'height': height, 'backgroundColor': color, 'backgroundOpacity': 8, 'borderColor': color + '99',
            'borderWidth': 1.5, 'borderRadius': 14, 'labelColor': color,
        })
        for annotation in node_annotations:
            if annotation['id'] in members:
                annotation['groupId'] = group_id

    annotations = {'nodeAnnotations': node_annotations}
    if group_annotations:
        annotations['groupStyleAnnotations'] = group_annotations
    if shapes:
        annotations['freeShapeAnnotations'] = [{'id': f'shape{i}', **shape} for i, shape in enumerate(shapes, 1)]
    if texts:
        annotations['freeTextAnnotations'] = [{'id': f'text{i}', **t} for i, t in enumerate(texts, 1)]

    return name, definition, json.dumps(annotations, indent=2)


def evpn_fabric():
    spines, leaves, servers, borders = ['spine1', 'spine2'], ['leaf1', 'leaf2', 'leaf3', 'leaf4'], \
        ['srv1', 'srv2', 'srv3', 'srv4'], ['border1', 'border2']
    positions = {
        'spine1': (400, 180), 'spine2': (720, 180), 'border1': (1180, 180), 'border2': (1180, 460),
        **{leaf: (x, 460) for leaf, x in zip(leaves, [200, 400, 720, 920])},
        **{server: (x, 660) for server, x in zip(servers, [200, 400, 720, 920])},
    }

    return topology(
        'evpn-fabric', positions,
        [(spine, leaf) for spine in spines for leaf in leaves + borders] + list(zip(servers, leaves)),
        {**dict.fromkeys(spines, 'spine'), **dict.fromkeys(leaves, 'leaf'), **dict.fromkeys(servers, 'server'),
         **dict.fromkeys(borders, 'dcgw')},
        {'g-spines': ('Spines · AS 65100', spines, VIOLET, 20),
         'g-pod-a': ('Pod A · AS 65001', ['leaf1', 'leaf2', 'srv1', 'srv2'], TEAL),
         'g-pod-b': ('Pod B · AS 65002', ['leaf3', 'leaf4', 'srv3', 'srv4'], BLUE),
         'g-border': ('Border · AS 65200', borders, AMBER)},
        [circle(1340, 245, 150, GREY, opacity=0.05),
         arrow((1222, 190), (1350, 285), GREY, style='dashed', start_arrow=True),
         arrow((1222, 450), (1350, 360), GREY, style='dashed', start_arrow=True),
         # The path of a packet from srv1 to srv4, through the VXLAN tunnel between leaf1 and leaf4
         arrow((150, 690), (150, 330), RED, end_arrow=False, width=2.5),
         arrow((150, 330), (970, 330), RED, style='dashed', end_arrow=False, width=2.5),
         arrow((970, 330), (970, 690), RED, width=2.5),
         rectangle(120, 780, 520, 92, GREY, opacity=0.04, style='solid', radius=10)],
        [text(1365, 300, '**Internet**\nvia eBGP', 13, GREY, 100, 'center'),
         text(430, 302, 'VXLAN tunnel **VNI 10100** · srv1 → srv4', 13, RED, 260, 'center'),
         text(120, 40, '# EVPN/VXLAN fabric\nTwo pods, one L2 domain stretched across the fabric.', width=420),
         text(140, 792, '**Underlay** eBGP on point-to-point links, one AS per layer\n'
                        '**Overlay** iBGP EVPN, spines as route reflectors\n'
                        '**Tenant** `blue` · VLAN 100 · 10.100.0.0/24', 13, '#dddddd', 480)],
    )


def mpls_l3vpn():
    core = ['p1', 'p2', 'p3', 'p4']
    positions = {
        'p1': (560, 220), 'p2': (780, 220), 'p3': (780, 440), 'p4': (560, 440), 'pe1': (340, 330),
        'pe2': (1000, 330), 'ce-zurich': (120, 200), 'ce-bern': (120, 460), 'ce-geneva': (1220, 330),
        'pc-zurich': (120, 60), 'pc-bern': (120, 600), 'srv-geneva': (1400, 330),
    }

    return topology(
        'mpls-l3vpn', positions,
        chain(core) + [('p4', 'p1'), ('p1', 'p3'), ('pe1', 'p1'), ('pe1', 'p4'), ('pe2', 'p2'), ('pe2', 'p3'),
                       ('ce-zurich', 'pe1'), ('ce-bern', 'pe1'), ('ce-geneva', 'pe2'), ('pc-zurich', 'ce-zurich'),
                       ('pc-bern', 'ce-bern'), ('srv-geneva', 'ce-geneva')],
        {**dict.fromkeys(core, 'router'), 'pe1': 'pe', 'pe2': 'pe', 'ce-zurich': 'rgw', 'ce-bern': 'rgw',
         'ce-geneva': 'rgw', 'pc-zurich': 'client', 'pc-bern': 'client', 'srv-geneva': 'server'},
        {'g-zurich': ('Site Zürich', ['ce-zurich', 'pc-zurich'], TEAL, 10),
         'g-bern': ('Site Bern', ['ce-bern', 'pc-bern'], TEAL, 10),
         'g-geneva': ('Site Geneva · DC', ['ce-geneva', 'srv-geneva'], AMBER, 10)},
        [circle(470, 130, 400, BLUE),
         arrow((296, 120), (400, 60), TEAL, style='dashed', start_arrow=True, end_arrow=False),
         arrow((400, 60), (1330, 60), TEAL, style='dashed', end_arrow=False),
         arrow((1330, 60), (1400, 250), TEAL, style='dashed'),
         arrow((380, 300), (530, 210), AMBER, width=2.5),
         arrow((590, 176), (750, 176), AMBER, width=2.5),
         arrow((810, 210), (960, 300), AMBER, width=2.5),
         rectangle(1180, 480, 300, 118, AMBER, opacity=0.12, style='solid', radius=6)],
        [text(590, 545, '**MPLS core** · AS 64512\nIS-IS · LDP · BGP VPNv4', 13, BLUE, 180, 'center'),
         text(740, 32, 'VRF `customer-a` · RT 64512:100', 13, TEAL, 260, 'center'),
         text(590, 236, 'LSP pe1 → pe2', 12, AMBER, 160, 'center'),
         text(1196, 494, '**Exercise**\n1. Bring up IS-IS and LDP in the core\n2. Peer pe1 and pe2 for VPNv4\n'
                         '3. Ping the Geneva server from Zürich', 13, '#ffe7b3', 270),
         text(120, -110, '# MPLS L3VPN\nOne customer, three sites, one VRF.', width=300)],
    )


def ospf_areas():
    positions = {
        'r1': (620, 180), 'r2': (860, 180), 'abr1': (500, 380), 'abr2': (980, 380), 'r3': (300, 600),
        'r4': (540, 640), 'r5': (940, 640), 'r6': (1180, 600), 'asbr': (740, 20), 'h1': (300, 800),
        'h2': (1180, 800),
    }

    return topology(
        'ospf-areas', positions,
        [('r1', 'r2'), ('r1', 'abr1'), ('r2', 'abr2'), ('r1', 'abr2'), ('abr1', 'r3'), ('abr1', 'r4'), ('r3', 'r4'),
         ('abr2', 'r5'), ('abr2', 'r6'), ('r5', 'r6'), ('asbr', 'r1'), ('asbr', 'r2'), ('h1', 'r3'), ('h2', 'r6')],
        {**dict.fromkeys(positions, 'router'), 'h1': 'client', 'h2': 'client'},
        {'g-area0': ('Area 0 · Backbone', ['r1', 'r2', 'abr1', 'abr2'], BLUE, 16),
         'g-area1': ('Area 1 · Stub', ['r3', 'r4', 'h1'], TEAL, 16),
         'g-area2': ('Area 2 · NSSA', ['r5', 'r6', 'h2'], VIOLET, 16)},
        [circle(690, -30, 100, AMBER, opacity=0.08, style='dotted'),
         arrow((440, 470), (380, 530), TEAL, style='dashed'),
         arrow((1040, 470), (1100, 530), VIOLET, style='dashed'),
         rectangle(1300, 40, 300, 160, '#fde68a', opacity=0.14, style='solid', radius=6)],
        [text(830, 0, '**ASBR**\nredistributes 0.0.0.0/0', 13, AMBER, 190),
         text(250, 450, 'Summary\n10.1.0.0/16', 12, TEAL, 110, 'right'),
         text(1110, 450, 'Type 7 LSAs\nbecome type 5', 12, VIOLET, 130),
         text(1318, 54, '**Your tasks**\n1. Configure the backbone\n2. Make area 1 a stub\n3. Make area 2 an NSSA\n'
                        '4. Check `show ip ospf route` on r3\n5. Ping h2 from h1', 13, '#fde68a', 270),
         text(120, -40, '# OSPF multi-area\nLab 4 · Routing protocols', width=320)],
    )


def seed_data():
    swiss = ['zurich', 'basel', 'bern', 'lausanne', 'geneva', 'lugano']
    branches = ['branch-lucerne', 'branch-stgallen', 'branch-chur', 'branch-sion', 'branch-thun']
    spines, leaves = ['spine1', 'spine2'], ['leaf1', 'leaf2', 'leaf3', 'leaf4']
    hosts = ['web1', 'web2', 'db1', 'cache1']

    return {
        'Network Fundamentals': [
            topology('hello-world', line(['client', 'server']), [('client', 'server')],
                     {'client': 'client', 'server': 'server'}),
            topology('office-lan', star('switch', ['reception', 'accounting', 'printer', 'laptop-anna', 'laptop-marc']),
                     [('switch', h) for h in ['reception', 'accounting', 'printer', 'laptop-anna', 'laptop-marc']],
                     {'switch': 'switch', 'printer': 'server'}),
            topology('daisy-chain', line(['host-a', 'r1', 'r2', 'r3', 'host-b']),
                     chain(['host-a', 'r1', 'r2', 'r3', 'host-b']),
                     {'r1': 'router', 'r2': 'router', 'r3': 'router'}),
        ],
        'Routing Labs': [
            topology('ospf-ring', ring(swiss), chain(swiss) + [(swiss[-1], swiss[0])], dict.fromkeys(swiss, 'router')),
            topology('hub-and-spoke', star('hq-zurich', branches), [('hq-zurich', b) for b in branches],
                     {'hq-zurich': 'dcgw', **dict.fromkeys(branches, 'router')}),
            topology('bgp-peering', tiers(['isp-swisscom', 'isp-init7', 'isp-salt'], ['edge1', 'edge2'], ['core']),
                     [('edge1', 'isp-swisscom'), ('edge1', 'isp-init7'), ('edge2', 'isp-init7'),
                      ('edge2', 'isp-salt'), ('core', 'edge1'), ('core', 'edge2')],
                     {'isp-swisscom': 'pe', 'isp-init7': 'pe', 'isp-salt': 'pe', 'edge1': 'router',
                      'edge2': 'router', 'core': 'router'}),
        ],
        'Datacenter': [
            topology('leaf-spine', tiers(spines, leaves, hosts),
                     [(s, l) for s in spines for l in leaves] + list(zip(leaves, hosts)),
                     {**dict.fromkeys(spines, 'spine'), **dict.fromkeys(leaves, 'leaf'),
                      **dict.fromkeys(hosts, 'server')}),
            topology('storage-mesh', ring(['ceph-mon1', 'ceph-mon2', 'ceph-mon3', 'ceph-osd1', 'ceph-osd2'], 200),
                     full_mesh(['ceph-mon1', 'ceph-mon2', 'ceph-mon3', 'ceph-osd1', 'ceph-osd2']),
                     dict.fromkeys(['ceph-mon1', 'ceph-mon2', 'ceph-mon3', 'ceph-osd1', 'ceph-osd2'], 'server')),
        ],
        'Security': [
            topology('dmz', {
                'internet': (0, 0), 'firewall': (0, 200),
                'web-proxy': (-300, 400), 'mail-relay': (-120, 400),
                'intranet': (120, 400), 'fileserver': (300, 400), 'admin-pc': (210, 600),
            }, [('internet', 'firewall'), ('firewall', 'web-proxy'), ('firewall', 'mail-relay'),
                ('firewall', 'intranet'), ('intranet', 'fileserver'), ('intranet', 'admin-pc')],
                {'internet': 'rgw', 'firewall': 'controller', 'web-proxy': 'server', 'mail-relay': 'server',
                 'intranet': 'switch', 'fileserver': 'server', 'admin-pc': 'client'},
                {'zone-dmz': ('DMZ', ['web-proxy', 'mail-relay'], '#f5a524'),
                 'zone-internal': ('Internal', ['intranet', 'fileserver', 'admin-pc'], '#3fcfad')}),
            topology('honeypot', tiers(['attacker'], ['sensor'], ['honeypot-ssh', 'honeypot-web', 'collector']),
                     [('attacker', 'sensor'), ('sensor', 'honeypot-ssh'), ('sensor', 'honeypot-web'),
                      ('sensor', 'collector')],
                     {'attacker': 'client', 'sensor': 'switch', 'honeypot-ssh': 'server',
                      'honeypot-web': 'server', 'collector': 'controller'}),
        ],
        'Showcase': [evpn_fabric(), mpls_l3vpn(), ospf_areas()],
    }


class ApiError(Exception):
    pass


class Api:
    def __init__(self, url):
        self.url = url.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.url + path, data, {'Content-Type': 'application/json'}, method=method)
        try:
            with self.opener.open(request) as response:
                content = response.read()
        except urllib.error.HTTPError as error:
            raise ApiError(f'{method} {path} failed with {error.code}: {error.read().decode()}')
        except urllib.error.URLError as error:
            sys.exit(f"Can't reach the server at {self.url}: {error.reason}")

        return json.loads(content).get('payload') if content else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--url', default='http://localhost:3100', help='API of the server')
    parser.add_argument('--username', default='admin')
    parser.add_argument('--password', default='admin')
    args = parser.parse_args()

    api = Api(args.url)
    try:
        api.request('POST', '/users/login/native', {'username': args.username, 'password': args.password})
        collections = {c['name']: c['id'] for c in api.request('GET', '/collections') or []}
        topologies = api.request('GET', '/topologies') or []
    except ApiError as error:
        sys.exit(str(error))

    existing = set()
    for t in topologies:
        if match := re.search(r'^name:\s*(\S+)', t['definition'], re.MULTILINE):
            existing.add((t['collectionId'], match.group(1).strip('\'"')))

    # Anything that exists or fails is logged and skipped, the rest is still created
    for collection_name, topologies in seed_data().items():
        if collection_name in collections:
            print(f'Skipped collection {collection_name}, it already exists')
        else:
            try:
                collections[collection_name] = api.request('POST', '/collections', {
                    'name': collection_name, 'publicWrite': True, 'publicDeploy': True,
                })
                print(f'Created collection {collection_name}')
            except ApiError as error:
                print(f'Skipped collection {collection_name} and its topologies: {error}')
                continue

        collection_id = collections[collection_name]
        for name, definition, annotations in topologies:
            if (collection_id, name) in existing:
                print(f'  Skipped {name}, it already exists')
                continue

            try:
                api.request('POST', '/topologies', {
                    'definition': definition, 'annotations': annotations, 'syncUrl': '',
                    'collectionId': collection_id,
                })
                print(f'  Created {name}')
            except ApiError as error:
                print(f'  Skipped {name}: {error}')


if __name__ == '__main__':
    main()
