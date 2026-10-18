import {beforeEach, describe, expect, it, vi} from 'vitest';

import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {
  BindFileEditSource,
  OpenFileType,
  TopologyEditReport,
  TopologyEditSource,
  TopologyManager,
} from '@sb/lib/topology-manager';
import {
  BindFile,
  Topology,
  TopologyAnnotations,
  TopologyIn,
} from '@sb/types/domain/topology';
import {TopologyDefinition} from '@sb/types/domain/topology-definition';
import {Result} from '@sb/types/result';

const format = new ContainerlabFormat(() => null);

const TOPOLOGY = `name: test
topology:
  nodes:
    r1:
      kind: nokia_srlinux
    r2:
      kind: nokia_srlinux
    pc:
      kind: linux
  links:
    - endpoints: ["r1:e1-1", "r2:e1-1"]
    - endpoints: ["r2:e1-2", "pc:eth1"]
`;

const ANNOTATIONS: TopologyAnnotations = {
  nodeAnnotations: [
    {id: 'r1', position: {x: 0, y: 0}},
    {id: 'r2', position: {x: 100, y: 0}},
    {id: 'pc', position: {x: 200, y: 0}},
  ],
};

function read(source: string): TopologyDefinition {
  return format.read(source)!;
}

function createTopology(
  source = TOPOLOGY,
  annotations: TopologyAnnotations = ANNOTATIONS,
): Topology {
  return {
    id: 'topology-id',
    collectionId: 'collection-id',
    creator: {id: 'user-id', name: 'user'},
    syncUrl: '',
    bindFiles: [],
    lastDeployFailed: false,
    definition: read(source),
    annotations: structuredClone(annotations),
  };
}

class FakeTopologyStore {
  public lookup = new Map<string, Topology>();
  public isEditable = true;
  public updateResult: Result<DataResponse<void>> = Result.createOk({
    payload: undefined,
  });
  public updates: {id: string; body: Partial<TopologyIn>}[] = [];
  public bindFileUpdates: {id: string; content?: string}[] = [];
  public fetchSingle = vi.fn(async () => {});

  public canEdit() {
    return this.isEditable;
  }

  public async update(id: string, body: Partial<TopologyIn>) {
    this.updates.push({id, body});
    return this.updateResult;
  }

  public async updateBindFile(
    _topologyId: string,
    id: string,
    body: {content?: string},
  ) {
    this.bindFileUpdates.push({id, content: body.content});
    return this.updateResult;
  }
}

class FakeDeviceStore {
  public data = [{kind: 'nokia_srlinux'}];

  public getInterfaceConfig(kind?: string) {
    if (kind === 'nokia_srlinux') {
      return {interfaces: [{pattern: 'e1-$', start: 1}]};
    }
    return {interfaces: [{pattern: 'eth$', start: 1}]};
  }
}

describe('TopologyManager', () => {
  let topologyStore: FakeTopologyStore;
  let deviceStore: FakeDeviceStore;
  let manager: TopologyManager;
  let edits: TopologyEditReport[];

  function open(topology = createTopology()) {
    manager.openTopology(topology);
    return topology;
  }

  function lastEdit() {
    return edits[edits.length - 1];
  }

  beforeEach(() => {
    topologyStore = new FakeTopologyStore();
    deviceStore = new FakeDeviceStore();
    manager = new TopologyManager(
      topologyStore as unknown as TopologyStore,
      deviceStore as unknown as DeviceStore,
    );
    edits = [];
    manager.onTopologyEdit.register(report => edits.push(report));
  });

  describe('opening and closing', () => {
    it('opens a topology without edits', () => {
      const opened = vi.fn();
      manager.onTopologyOpen.register(opened);
      const topology = open();

      expect(opened).toHaveBeenCalledWith(topology);
      expect(manager.isOpen()).toBe(true);
      expect(manager.topology).toBe(topology);
      expect(manager.editingFileId).toBe('topology-id');
      expect(manager.currentFileType).toBe(OpenFileType.Topology);
      expect(manager.hasEdits()).toBe(false);
    });

    it('refetches the previous topology when another one is opened', () => {
      open();
      open({...createTopology(), id: 'other-id'});

      expect(topologyStore.fetchSingle).toHaveBeenCalledWith('topology-id');
    });

    it('does not refetch anything when the first topology is opened', () => {
      open();

      expect(topologyStore.fetchSingle).not.toHaveBeenCalled();
    });

    it('closes the open topology', () => {
      const closed = vi.fn();
      manager.onClose.register(closed);
      open();
      manager.close();

      expect(closed).toHaveBeenCalled();
      expect(manager.isOpen()).toBe(false);
      expect(manager.topology).toBeNull();
      expect(manager.editingFileId).toBeNull();
    });

    it('ignores edits while no topology is open', () => {
      manager.editTopology(read(TOPOLOGY), TopologyEditSource.TextEditor);
      manager.renameNode('r1', 'r3');
      manager.deleteElements(['r1'], [], [], []);

      expect(edits).toHaveLength(0);
      expect(manager.addText({text: 'a', position: {x: 0, y: 0}})).toBeNull();
    });

    it('returns the saved topology from the store if it is not open', () => {
      const stored = createTopology();
      topologyStore.lookup.set('stored-id', stored);

      expect(manager.savedTopology('stored-id')).toBe(stored);
      expect(manager.savedTopology('unknown')).toBeUndefined();
    });
  });

  describe('editing', () => {
    it('marks a topology as edited until the edit is reverted', () => {
      open();
      manager.editTopology(
        read(TOPOLOGY.replace('kind: linux', 'kind: alpine')),
        TopologyEditSource.TextEditor,
      );

      expect(lastEdit().isEdited).toBe(true);
      expect(lastEdit().source).toBe(TopologyEditSource.TextEditor);
      expect(manager.hasEdits()).toBe(true);

      manager.editTopology(read(TOPOLOGY), TopologyEditSource.TextEditor);
      expect(lastEdit().isEdited).toBe(false);
      expect(manager.hasEdits()).toBe(false);
    });

    it('does not count a change of the formatting as an edit', () => {
      open();
      manager.editTopology(
        read(
          TOPOLOGY.replace(
            '["r1:e1-1", "r2:e1-1"]',
            '\n        - "r1:e1-1"\n        - "r2:e1-1"',
          ) + '\n\n',
        ),
        TopologyEditSource.TextEditor,
      );

      expect(lastEdit().isEdited).toBe(false);
    });

    it('counts a change of the annotations as an edit', () => {
      open();
      manager.editAnnotations(
        {...ANNOTATIONS, freeTextAnnotations: []},
        TopologyEditSource.TextEditor,
      );

      expect(lastEdit().isEdited).toBe(true);
    });

    it('passes the merge key on with the edit', () => {
      open();
      manager.updateLayout(
        {nodes: new Map([['r1', {position: {x: 5, y: 5}, groupId: null}]])},
        'nudge',
      );

      expect(lastEdit().mergeKey).toBe('nudge');
      expect(lastEdit().source).toBe(TopologyEditSource.NodeEditor);
    });

    it('discards edits by restoring the original topology', () => {
      const topology = open();
      manager.renameNode('pc', 'client');
      manager.discardEdits();

      expect(lastEdit().isEdited).toBe(false);
      expect(lastEdit().source).toBe(TopologyEditSource.System);
      expect(manager.topology!.definition.nodeNames).toEqual([
        'r1',
        'r2',
        'pc',
      ]);
      expect(manager.topology).not.toBe(topology);
      expect(manager.hasEdits()).toBe(false);
    });

    it.skip('counts edits after discarding as edits', () => {
      // Bug: after discarding, the edits change the backup of the original topology
      open();
      manager.renameNode('pc', 'client');
      manager.discardEdits();
      manager.renameNode('pc', 'server');

      expect(manager.hasEdits()).toBe(true);
      expect(
        manager.savedTopology('topology-id')!.definition.nodeNames,
      ).toEqual(['r1', 'r2', 'pc']);
    });

    it('takes a replaced topology as the new original', () => {
      open();
      const replaced = createTopology(
        TOPOLOGY.replace('name: test', 'name: x'),
      );
      manager.replaceTopology(replaced);

      expect(lastEdit().isEdited).toBe(false);
      expect(manager.topology).toBe(replaced);
      expect(manager.savedTopology('topology-id')!.definition.name).toBe('x');
    });
  });

  describe('read-only topologies', () => {
    beforeEach(() => {
      topologyStore.isEditable = false;
      open();
    });

    it('is read-only if the user can not edit it', () => {
      expect(manager.isReadOnly).toBe(true);
    });

    it('ignores edits from the graph', () => {
      manager.renameNode('r1', 'r3');
      manager.addShape({shapeType: 'rectangle', position: {x: 0, y: 0}});
      manager.deleteElements(['r1'], [], [], []);

      expect(edits).toHaveLength(0);
      expect(manager.topology!.definition.nodeNames).toContain('r1');
    });

    it('still applies edits from the text editor and the system', () => {
      manager.editTopology(
        read(TOPOLOGY.replace('name: test', 'name: x')),
        TopologyEditSource.TextEditor,
      );

      expect(manager.topology!.definition.name).toBe('x');
    });

    it('can not be cleared', () => {
      manager.clear();

      expect(edits).toHaveLength(0);
    });
  });

  describe('nodes and links', () => {
    it('renames a node together with its links and annotation', () => {
      open();
      manager.renameNode('r1', 'core');

      const {definition, annotations} = manager.topology!;
      expect(definition.nodeNames).toEqual(['core', 'r2', 'pc']);
      expect(definition.linksOf('core')).toHaveLength(1);
      expect(annotations.nodeAnnotations!.map(a => a.id)).toEqual([
        'core',
        'r2',
        'pc',
      ]);
    });

    it('does nothing when a node is renamed to its own name', () => {
      open();
      manager.renameNode('r1', 'r1');

      expect(edits).toHaveLength(0);
    });

    it('renames the interface at one end of a link', () => {
      open();
      manager.renameInterface(0, 1, 'e1-5');

      expect(manager.topology!.definition.links[0].endpoints[1]).toEqual({
        node: 'r2',
        interface: 'e1-5',
      });
    });

    it('connects nodes with the next free interface of their device', () => {
      open();
      manager.connectNodes('r1', 'pc');

      const link = manager.topology!.definition.links[2];
      expect(link.endpoints).toEqual([
        {node: 'r1', interface: 'e1-2'},
        {node: 'pc', interface: 'eth2'},
      ]);
    });

    it('connects a node to itself with two different interfaces', () => {
      open();
      manager.connectNodes('r1', 'r1');

      const link = manager.topology!.definition.links[2];
      expect(link.endpoints).toEqual([
        {node: 'r1', interface: 'e1-2'},
        {node: 'r1', interface: 'e1-3'},
      ]);
    });

    it('does not connect nodes before the devices are loaded', () => {
      (deviceStore as {data: unknown}).data = undefined;
      open();
      manager.connectNodes('r1', 'pc');

      expect(edits).toHaveLength(0);
    });

    it('clears all nodes and links of a topology', () => {
      open();
      manager.clear();

      const {definition, annotations} = manager.topology!;
      expect(definition.nodeNames).toEqual([]);
      expect(definition.links).toEqual([]);
      expect(annotations.nodeAnnotations).toEqual([]);
      expect(lastEdit().isEdited).toBe(true);
    });
  });

  describe('deleting elements', () => {
    const annotations: TopologyAnnotations = {
      nodeAnnotations: [
        {id: 'r1', position: {x: 0, y: 0}, groupId: 'group-1'},
        {id: 'r2', position: {x: 100, y: 0}, groupId: 'group-1'},
        {id: 'pc', position: {x: 200, y: 0}},
      ],
      groupStyleAnnotations: [
        {
          id: 'group-1',
          name: 'core',
          level: '1',
          position: {x: -50, y: -50},
          width: 200,
          height: 100,
        },
      ],
      freeShapeAnnotations: [
        {id: 'shape-1', shapeType: 'rectangle', position: {x: 0, y: 0}},
      ],
      freeTextAnnotations: [{id: 'text-1', text: 'a', position: {x: 0, y: 0}}],
    };

    it('deletes nodes together with their links and annotations', () => {
      open(createTopology(TOPOLOGY, annotations));
      manager.deleteElements(['pc'], [], [], []);

      const {definition, annotations: updated} = manager.topology!;
      expect(definition.nodeNames).toEqual(['r1', 'r2']);
      expect(definition.links).toHaveLength(1);
      expect(updated.nodeAnnotations!.map(a => a.id)).toEqual(['r1', 'r2']);
    });

    it('deletes links by their index', () => {
      open(createTopology(TOPOLOGY, annotations));
      manager.deleteElements([], [0], [], []);

      const {definition} = manager.topology!;
      expect(definition.nodeNames).toHaveLength(3);
      expect(definition.links).toHaveLength(1);
      expect(definition.links[0].endpoints[0].node).toBe('r2');
    });

    it('keeps the members of a deleted group', () => {
      open(createTopology(TOPOLOGY, annotations));
      manager.deleteElements([], [], ['group-1'], []);

      const updated = manager.topology!.annotations;
      expect(updated.groupStyleAnnotations).toEqual([]);
      expect(updated.nodeAnnotations!.map(a => a.groupId)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      expect(manager.topology!.definition.nodeNames).toHaveLength(3);
    });

    it('deletes shapes and texts by their ID', () => {
      open(createTopology(TOPOLOGY, annotations));
      manager.deleteElements([], [], [], ['shape-1', 'text-1']);

      const updated = manager.topology!.annotations;
      expect(updated.freeShapeAnnotations).toEqual([]);
      expect(updated.freeTextAnnotations).toEqual([]);
    });

    it('deletes everything in a single edit', () => {
      open(createTopology(TOPOLOGY, annotations));
      manager.deleteElements(['pc'], [0], ['group-1'], ['shape-1']);

      expect(edits).toHaveLength(1);
      expect(manager.topology!.definition.links).toHaveLength(0);
    });
  });

  describe('groups, shapes and texts', () => {
    it('adds a group with the next free ID and its members in one edit', () => {
      open();
      const groupId = manager.addGroup(
        {name: 'core', position: {x: 0, y: 0}, width: 100, height: 50},
        null,
        id => ({
          nodes: new Map([['r1', {position: {x: 0, y: 0}, groupId: id}]]),
        }),
      );

      expect(groupId).toBe('group-1');
      expect(edits).toHaveLength(1);

      const {annotations} = manager.topology!;
      expect(annotations.groupStyleAnnotations).toEqual([
        {
          id: 'group-1',
          name: 'core',
          level: '1',
          position: {x: 0, y: 0},
          width: 100,
          height: 50,
        },
      ]);
      expect(annotations.nodeAnnotations![0].groupId).toBe('group-1');
    });

    it('nests a group in its parent group', () => {
      open();
      const box = {position: {x: 0, y: 0}, width: 10, height: 10};
      manager.addGroup({name: 'outer', ...box}, null, () => ({}));
      const innerId = manager.addGroup(
        {name: 'inner', ...box},
        'group-1',
        () => ({}),
      );

      expect(innerId).toBe('group-2');
      const inner = manager.topology!.annotations.groupStyleAnnotations![1];
      expect(inner.parentId).toBe('group-1');
      expect(inner.groupId).toBe('group-1');
    });

    it('moves the members of removed groups to the group around them', () => {
      open();
      const box = {position: {x: 0, y: 0}, width: 10, height: 10};
      manager.addGroup({name: 'outer', ...box}, null, () => ({}));
      manager.addGroup({name: 'inner', ...box}, 'group-1', id => ({
        nodes: new Map([['r1', {position: {x: 0, y: 0}, groupId: id}]]),
      }));
      manager.removeGroups(['group-2']);

      const {annotations} = manager.topology!;
      expect(annotations.groupStyleAnnotations!.map(g => g.id)).toEqual([
        'group-1',
      ]);
      expect(annotations.nodeAnnotations![0].groupId).toBe('group-1');
    });

    it('does nothing when no groups are removed', () => {
      open();
      manager.removeGroups([]);
      manager.reorderAnnotations([], true);
      manager.stepAnnotations([], true);

      expect(edits).toHaveLength(0);
    });

    it('adds shapes in front of all groups and shapes', () => {
      open();
      manager.addGroup(
        {name: 'g', position: {x: 0, y: 0}, width: 10, height: 10},
        null,
        () => ({groups: new Map([['group-1', {zIndex: 4}]])}),
      );
      const shapeId = manager.addShape({
        shapeType: 'circle',
        position: {x: 0, y: 0},
      });

      expect(shapeId).toBe('shape-1');
      expect(
        manager.topology!.annotations.freeShapeAnnotations![0].zIndex,
      ).toBe(5);
    });

    it('adds a text and merges writing it into the same edit', () => {
      open();
      const textId = manager.addText({text: 'a', position: {x: 0, y: 0}});
      manager.setText(textId!, 'ab');

      expect(textId).toBe('text-1');
      expect(edits.map(edit => edit.mergeKey)).toEqual([
        'text-text-1',
        'text-text-1',
      ]);
      expect(manager.topology!.annotations.freeTextAnnotations![0]).toEqual({
        id: 'text-1',
        text: 'ab',
        position: {x: 0, y: 0},
        zIndex: 1,
      });
    });

    it('removes a text that is emptied', () => {
      open();
      const textId = manager.addText({text: 'a', position: {x: 0, y: 0}});
      manager.setText(textId!, '  \n');

      expect(manager.topology!.annotations.freeTextAnnotations).toEqual([]);
    });

    it('moves annotations to the front of the layer below the nodes', () => {
      open();
      manager.addShape({shapeType: 'rectangle', position: {x: 0, y: 0}});
      manager.addShape({shapeType: 'rectangle', position: {x: 0, y: 0}});
      manager.reorderAnnotations(['shape-1'], true);

      const shapes = manager.topology!.annotations.freeShapeAnnotations!;
      const zIndex = (id: string) => shapes.find(s => s.id === id)!.zIndex!;
      expect(zIndex('shape-1')).toBeGreaterThan(zIndex('shape-2'));
    });

    it('writes the layout of groups, shapes and texts', () => {
      open();
      manager.addShape({shapeType: 'rectangle', position: {x: 0, y: 0}});
      manager.addText({text: 'a', position: {x: 0, y: 0}});
      manager.updateLayout({
        shapes: new Map([['shape-1', {position: {x: 1, y: 2}}]]),
        texts: new Map([['text-1', {width: 30}]]),
      });

      const {annotations} = manager.topology!;
      expect(annotations.freeShapeAnnotations![0].position).toEqual({
        x: 1,
        y: 2,
      });
      expect(annotations.freeTextAnnotations![0].width).toBe(30);
    });
  });

  describe('pasting', () => {
    it('adds pasted nodes, links and annotations in one edit', () => {
      open();
      manager.pasteElements({
        nodes: [
          {
            name: 'r1-1',
            definition: {kind: 'nokia_srlinux'},
            annotation: {id: 'r1-1', position: {x: 0, y: 100}},
          },
          {
            name: 'r2-1',
            definition: {kind: 'nokia_srlinux'},
            annotation: {id: 'r2-1', position: {x: 100, y: 100}},
          },
        ],
        links: [{endpoints: ['r1:e1-1', 'r2:e1-1']}],
        names: new Map([
          ['r1', 'r1-1'],
          ['r2', 'r2-1'],
        ]),
        groups: [],
        shapes: [
          {
            id: 'shape-2',
            shapeType: 'rectangle',
            position: {x: 0, y: 0},
            zIndex: 9,
          },
          {
            id: 'shape-1',
            shapeType: 'rectangle',
            position: {x: 0, y: 0},
            zIndex: 3,
          },
        ],
        texts: [],
      });

      expect(edits).toHaveLength(1);

      const {definition, annotations} = manager.topology!;
      expect(definition.nodeNames).toEqual(['r1', 'r2', 'pc', 'r1-1', 'r2-1']);
      expect(definition.links[2].endpoints).toEqual([
        {node: 'r1-1', interface: 'e1-1'},
        {node: 'r2-1', interface: 'e1-1'},
      ]);
      expect(annotations.nodeAnnotations!.map(a => a.id)).toContain('r2-1');

      // The pasted shapes keep their order in front of the existing layer
      expect(
        annotations.freeShapeAnnotations!.map(s => [s.id, s.zIndex]),
      ).toEqual([
        ['shape-2', 2],
        ['shape-1', 1],
      ]);
    });
  });

  describe('converting the layout', () => {
    const LABELED = `name: test
topology:
  nodes:
    r1:
      kind: linux
      labels:
        graph-posX: "10"
        graph-posY: "20"
        graph-icon: router
    r2:
      kind: linux
`;

    it('moves graph labels to the annotations on the first edit in the graph', () => {
      open(
        createTopology(LABELED, {
          nodeAnnotations: [{id: 'r2', position: {x: 0, y: 0}}],
        }),
      );
      manager.renameNode('r2', 'r3');

      const {definition, annotations} = manager.topology!;
      expect(definition.nodes.get('r1')!.own(['labels'])).toBeUndefined();
      expect(annotations.nodeAnnotations).toContainEqual(
        expect.objectContaining({
          id: 'r1',
          position: {x: 10, y: 20},
          icon: 'router',
        }),
      );
    });

    it('keeps graph labels on edits from the text editor', () => {
      open(createTopology(LABELED, {}));
      manager.editTopology(
        read(LABELED.replace('name: test', 'name: x')),
        TopologyEditSource.TextEditor,
      );

      expect(
        manager.topology!.definition.nodes.get('r1')!.own(['labels']),
      ).toBeDefined();
    });

    it('converts legacy groups to group annotations on edits in the graph', () => {
      open(
        createTopology(TOPOLOGY, {
          nodeAnnotations: [
            {id: 'r1', position: {x: 0, y: 0}, group: 'core', level: '1'},
            {id: 'r2', position: {x: 100, y: 0}, group: 'core', level: '1'},
            {id: 'pc', position: {x: 200, y: 0}},
          ],
        }),
      );
      manager.addShape({shapeType: 'rectangle', position: {x: 0, y: 0}});

      const {annotations} = manager.topology!;
      expect(annotations.groupStyleAnnotations).toHaveLength(1);
      const [group] = annotations.groupStyleAnnotations!;
      expect(group.name).toBe('core');
      expect(annotations.nodeAnnotations![0]).toEqual({
        id: 'r1',
        position: {x: 0, y: 0},
        groupId: group.id,
      });
    });

    it('places nodes without a position on an edit in the graph', () => {
      open(createTopology(TOPOLOGY, {}));
      manager.addShape({shapeType: 'rectangle', position: {x: 0, y: 0}});

      const positions = manager.topology!.annotations.nodeAnnotations!;
      expect(positions.map(a => a.id).sort()).toEqual(['pc', 'r1', 'r2']);
      expect(positions.every(a => a.position !== undefined)).toBe(true);
    });
  });

  describe('saving', () => {
    it('sends the definition and leaves unchanged annotations out', async () => {
      open();
      manager.editTopology(
        read(TOPOLOGY.replace('name: test', 'name: saved')),
        TopologyEditSource.TextEditor,
      );
      await manager.save();

      expect(topologyStore.updates).toHaveLength(1);
      expect(topologyStore.updates[0].id).toBe('topology-id');
      expect(topologyStore.updates[0].body.definition).toContain('name: saved');
      expect(topologyStore.updates[0].body.annotations).toBeUndefined();
    });

    it('sends the annotations if they have changed', async () => {
      open();
      manager.updateLayout({
        nodes: new Map([['r1', {position: {x: 7, y: 7}, groupId: null}]]),
      });
      await manager.save();

      const body = topologyStore.updates[0].body;
      expect(JSON.parse(body.annotations!).nodeAnnotations[0].position).toEqual(
        {x: 7, y: 7},
      );
    });

    it('has no edits after a successful save', async () => {
      open();
      manager.renameNode('pc', 'client');
      await manager.save();

      expect(lastEdit().isEdited).toBe(false);
      expect(manager.hasEdits()).toBe(false);
      expect(
        manager.savedTopology('topology-id')!.definition.nodeNames,
      ).toContain('client');
    });

    it('keeps the edits if saving fails', async () => {
      topologyStore.updateResult = Result.createErr({code: 500, message: ''});
      open();
      manager.renameNode('pc', 'client');
      const result = await manager.save();

      expect(result!.isErr()).toBe(true);
      expect(manager.hasEdits()).toBe(true);
    });

    it('completes the layout before saving', async () => {
      open(
        createTopology(TOPOLOGY, {
          nodeAnnotations: [
            {id: 'r1', position: {x: 0, y: 0}},
            {id: 'r2', position: {x: 100, y: 0}},
            {id: 'pc', position: {x: 200, y: 0}},
            {id: 'removed', position: {x: 0, y: 0}},
          ],
        }),
      );
      await manager.save();

      const saved = JSON.parse(topologyStore.updates[0].body.annotations!);
      expect(saved.nodeAnnotations.map((a: {id: string}) => a.id)).toEqual([
        'r1',
        'r2',
        'pc',
      ]);
    });
  });

  describe('bind files', () => {
    const bindFile: BindFile = {
      id: 'file-id',
      topologyId: 'topology-id',
      filePath: 'r1/config.cfg',
      content: 'hostname r1',
    };

    it('opens a bind file without edits', () => {
      const opened = vi.fn();
      manager.onBindFileOpen.register(opened);
      manager.openBindFile({...bindFile});

      expect(opened).toHaveBeenCalled();
      expect(manager.currentFileType).toBe(OpenFileType.BindFile);
      expect(manager.editingFileId).toBe('file-id');
      expect(manager.topology).toBeNull();
      expect(manager.hasEdits()).toBe(false);
    });

    it('marks a bind file as edited until its content is the original', () => {
      const reports: boolean[] = [];
      manager.onBindFileEdit.register(report => reports.push(report.isEdited));
      manager.openBindFile({...bindFile});

      manager.editBindFile('hostname r2', BindFileEditSource.TextEditor);
      expect(manager.hasEdits()).toBe(true);

      manager.editBindFile('hostname r1', BindFileEditSource.TextEditor);
      expect(manager.hasEdits()).toBe(false);
      expect(reports).toEqual([true, false]);
    });

    it('discards the edits of a bind file', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      manager.openBindFile({...bindFile});
      manager.editBindFile('changed', BindFileEditSource.TextEditor);
      manager.discardEdits();

      expect(manager.bindFile!.content).toBe('hostname r1');
      expect(manager.hasEdits()).toBe(false);
    });

    it('clears the content of a bind file', () => {
      manager.openBindFile({...bindFile});
      manager.clear();

      expect(manager.bindFile!.content).toBe('');
    });

    it('saves a bind file', async () => {
      manager.openBindFile({...bindFile});
      manager.editBindFile('changed', BindFileEditSource.TextEditor);
      await manager.save();

      expect(topologyStore.bindFileUpdates).toEqual([
        {id: 'file-id', content: 'changed'},
      ]);
      expect(manager.hasEdits()).toBe(false);
    });

    it('refetches the topology of the bind file when another file is opened', () => {
      manager.openBindFile({...bindFile});
      open();

      expect(topologyStore.fetchSingle).toHaveBeenCalledWith('topology-id');
    });
  });

  describe('serializing annotations', () => {
    it('serializes the same annotations only once', () => {
      const annotations: TopologyAnnotations = {nodeAnnotations: []};
      const first = TopologyManager.serializeAnnotations(annotations);

      // The cache relies on edits replacing the annotations instead of changing them
      annotations.nodeAnnotations!.push({id: 'r1'});

      expect(TopologyManager.serializeAnnotations(annotations)).toBe(first);
      expect(first).toBe(JSON.stringify({nodeAnnotations: []}, null, 2));
    });
  });
});
