import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  ANNOTATIONS_FILE,
  DEFINITION_FILE,
  TopologyDocument,
} from '@sb/lib/editor/document/topology-document';
import {DraftStorage} from '@sb/lib/editor/draft-storage';
import {FileEditSource} from '@sb/lib/editor/file-buffer';
import {GraphModel} from '@sb/lib/editor/graph-model';
import {serializeAnnotations} from '@sb/lib/format/annotations-format';
import {Topology, TopologyAnnotations} from '@sb/types/domain/topology';
import {Result} from '@sb/types/result';

import {
  ANNOTATIONS,
  createTopology,
  EditorTestBed,
  FakeTopologyStore,
  setUpEditorTest,
  tearDownEditorTest,
  TOPOLOGY,
} from '../fakes';

let bed: EditorTestBed;
let topologyStore: FakeTopologyStore;
let drafts: DraftStorage;

beforeEach(() => {
  bed = setUpEditorTest();
  ({topologyStore, drafts} = bed);
});

afterEach(tearDownEditorTest);

const addTopology = (topology?: Topology) => bed.addTopology(topology);

describe('TopologyDocument', () => {
  let doc: TopologyDocument;
  let manager: GraphModel;

  function open(topology = createTopology()) {
    addTopology(topology);
    doc = bed.topologyDocument(topology);
    manager = doc.graph;
    return topology;
  }

  function definitionBuffer() {
    return doc.files.find(file => file.id === DEFINITION_FILE)!.buffer!;
  }

  function annotationsBuffer() {
    return doc.files.find(file => file.id === ANNOTATIONS_FILE)!.buffer!;
  }

  // Types the text of the definition and waits until it's read
  function type(text: string) {
    definitionBuffer().setText(text, FileEditSource.TextEditor);
    vi.runOnlyPendingTimers();
  }

  describe('opening', () => {
    it('opens a topology without edits, showing its definition', () => {
      open();

      expect(doc.title).toBe('test');
      expect(doc.subtitle).toBe('collection');
      expect(doc.files.map(file => file.id)).toEqual([
        DEFINITION_FILE,
        ANNOTATIONS_FILE,
      ]);
      expect(doc.files[0].fileName).toBe('test.clab.yml');
      expect(doc.activeFile.id).toBe(DEFINITION_FILE);
      expect(doc.isEdited).toBe(false);
      expect(doc.history.canUndo).toBe(false);
      expect(doc.capabilities).toEqual({
        views: ['split', 'code', 'graph'],
        sync: true,
        deploy: true,
        readOnly: false,
      });
    });

    it('works on its own copy, the saved topology stays as it is', () => {
      const topology = open();
      manager.renameNode('pc', 'client');

      expect(manager.topology!.definition.nodeNames).toContain('client');
      expect(topology.definition.nodeNames).toContain('pc');
    });
  });

  describe('editing', () => {
    it('marks the document as edited until the text is the saved one again', () => {
      open();
      type(TOPOLOGY.replace('kind: linux', 'kind: alpine'));

      expect(doc.isEdited).toBe(true);
      expect(manager.topology!.definition.nodes.get('pc')!.get('kind')).toBe(
        'alpine',
      );

      type(TOPOLOGY);
      expect(doc.isEdited).toBe(false);
    });

    it('counts a change of the annotations as an edit of the document', () => {
      open();
      manager.updateLayout({
        nodes: new Map([['r1', {position: {x: 5, y: 5}, groupId: null}]]),
      });

      expect(annotationsBuffer().isEdited).toBe(true);
      expect(definitionBuffer().isEdited).toBe(false);
      expect(doc.isEdited).toBe(true);
    });

    it('keeps showing the last valid definition while the text is invalid', () => {
      open();
      type('name: [');

      expect(doc.isValid).toBe(false);
      expect(manager.topology!.definition.name).toBe('test');
    });

    it('reads typed text only after a short delay', () => {
      open();
      definitionBuffer().setText(
        TOPOLOGY.replace('name: test', 'name: x'),
        FileEditSource.TextEditor,
      );

      expect(doc.isParsing).toBe(true);
      expect(manager.topology!.definition.name).toBe('test');

      vi.runOnlyPendingTimers();
      expect(doc.isParsing).toBe(false);
      expect(manager.topology!.definition.name).toBe('x');
    });
  });

  describe('undo and redo', () => {
    it('undoes a change of the graph that changes both files in one step', () => {
      open();
      manager.renameNode('r1', 'core');
      const undone = doc.undo();

      expect(undone?.file).toBe(DEFINITION_FILE);
      expect(manager.topology!.definition.nodeNames).toEqual([
        'r1',
        'r2',
        'pc',
      ]);
      expect(manager.topology!.annotations.nodeAnnotations![0].id).toBe('r1');
      expect(doc.isEdited).toBe(false);

      doc.redo();
      expect(manager.topology!.definition.nodeNames).toContain('core');
      expect(manager.topology!.annotations.nodeAnnotations![0].id).toBe('core');
    });

    it('reports the annotations as the file of a change of the layout', () => {
      open();
      manager.updateLayout({
        nodes: new Map([['r1', {position: {x: 5, y: 5}, groupId: null}]]),
      });

      expect(doc.undo()?.file).toBe(ANNOTATIONS_FILE);
    });

    it('merges typing in a file into one change', () => {
      open();
      definitionBuffer().setText(TOPOLOGY + '#', FileEditSource.TextEditor);
      definitionBuffer().setText(TOPOLOGY + '#a', FileEditSource.TextEditor);

      expect(doc.history.length).toBe(2);
    });

    it('records a replaced text as its own change', () => {
      open();
      doc.replaceText(DEFINITION_FILE, TOPOLOGY.replace('test', 'pulled'));

      expect(doc.history.length).toBe(2);
      expect(manager.topology!.definition.name).toBe('pulled');
    });

    it('keeps the selection of the graph before a change for undo', () => {
      open();
      const selection = {
        nodeIds: ['r1'],
        groupIds: [],
        shapeIds: [],
        textIds: [],
      };
      doc.setSelectionProviders(null, () => selection);
      manager.renameNode('r1', 'core');

      expect(doc.undo()?.graphSelection).toEqual(selection);
    });
  });

  describe('drafts', () => {
    it('keeps unsaved changes as a draft and restores them', () => {
      const topology = open();
      manager.renameNode('pc', 'client');
      vi.runOnlyPendingTimers();
      doc.dispose();

      const reopened = bed.topologyDocument(topology);
      expect(reopened.isEdited).toBe(true);
      expect(reopened.hasConflict).toBe(false);
      expect(reopened.graph.topology!.definition.nodeNames).toContain('client');
    });

    it('deletes the draft once the changes are undone', () => {
      open();
      manager.renameNode('pc', 'client');
      vi.runOnlyPendingTimers();
      doc.undo();
      vi.runOnlyPendingTimers();

      expect(drafts.load('topology-id')).toBeNull();
    });

    it('restores a draft made on an older version as a conflict', () => {
      const topology = open();
      manager.renameNode('pc', 'client');
      vi.runOnlyPendingTimers();
      doc.dispose();

      topologyStore.store('topology-id', {
        definition: TOPOLOGY.replace('name: test', 'name: renamed'),
      });
      const reopened = bed.topologyDocument(topology);

      expect(reopened.hasConflict).toBe(true);
      expect(reopened.graph.topology!.definition.nodeNames).toContain('client');
    });

    it('ignores the draft of another user', () => {
      const topology = open();
      manager.renameNode('pc', 'client');
      vi.runOnlyPendingTimers();
      doc.dispose();

      const other = bed.topologyDocument(
        topology,
        new DraftStorage('other-user'),
      );
      expect(other.isEdited).toBe(false);
    });
  });

  describe('newer saved versions', () => {
    it('shows a newer saved version if there are no changes', () => {
      open();
      topologyStore.store('topology-id', {
        definition: TOPOLOGY.replace('name: test', 'name: renamed'),
      });

      expect(doc.hasConflict).toBe(false);
      expect(doc.isEdited).toBe(false);
      expect(manager.topology!.definition.name).toBe('renamed');
    });

    it('keeps the changes and reports a conflict if there are changes', () => {
      open();
      manager.renameNode('pc', 'client');
      topologyStore.store('topology-id', {
        definition: TOPOLOGY.replace('name: test', 'name: renamed'),
      });

      expect(doc.hasConflict).toBe(true);
      expect(manager.topology!.definition.nodeNames).toContain('client');
    });

    it('keeps the changes on top of the newer version', () => {
      open();
      manager.renameNode('pc', 'client');
      topologyStore.store('topology-id', {
        definition: TOPOLOGY.replace('name: test', 'name: renamed'),
      });
      doc.keepChanges();

      expect(doc.hasConflict).toBe(false);
      expect(doc.isEdited).toBe(true);
      expect(manager.topology!.definition.nodeNames).toContain('client');
    });

    it('goes back to the newer version when the changes are reverted', () => {
      open();
      manager.renameNode('pc', 'client');
      topologyStore.store('topology-id', {
        definition: TOPOLOGY.replace('name: test', 'name: renamed'),
      });
      doc.revert();

      expect(doc.hasConflict).toBe(false);
      expect(doc.isEdited).toBe(false);
      expect(manager.topology!.definition.name).toBe('renamed');
      expect(manager.topology!.definition.nodeNames).toContain('pc');
    });

    it('renames the topology in the changes', () => {
      open();
      manager.renameNode('pc', 'client');
      topologyStore.store('topology-id', {
        definition: TOPOLOGY.replace('name: test', 'name: renamed'),
      });
      doc.applyRename('renamed');

      expect(doc.hasConflict).toBe(false);
      expect(manager.topology!.definition.name).toBe('renamed');
      expect(manager.topology!.definition.nodeNames).toContain('client');
    });

    it('keeps text that is not valid when the topology is renamed', () => {
      open();
      const invalid = TOPOLOGY + '  - [';
      definitionBuffer().setText(invalid, FileEditSource.TextEditor);
      topologyStore.store('topology-id', {
        definition: TOPOLOGY.replace('name: test', 'name: renamed'),
      });
      doc.applyRename('renamed');

      expect(doc.hasConflict).toBe(false);
      expect(definitionBuffer().text).toBe(invalid);
    });

    it('takes annotations the server stores reformatted as saved', async () => {
      open();
      const reformatted = JSON.stringify(
        {...ANNOTATIONS, freeTextAnnotations: []},
        null,
        4,
      );
      annotationsBuffer().setText(reformatted, FileEditSource.TextEditor);
      vi.runOnlyPendingTimers();
      await doc.save();

      expect(doc.isEdited).toBe(false);
      expect(annotationsBuffer().text).toBe(
        serializeAnnotations({...ANNOTATIONS, freeTextAnnotations: []}),
      );
    });
  });

  describe('saving', () => {
    it('does not save a file that can not be read', async () => {
      open();
      type('name: [');
      const result = await doc.save();

      expect(result.isErr()).toBe(true);
      expect(topologyStore.updates).toHaveLength(0);
    });

    it('deletes the draft after saving', async () => {
      open();
      manager.renameNode('pc', 'client');
      vi.runOnlyPendingTimers();
      await doc.save();

      expect(drafts.load('topology-id')).toBeNull();
    });
  });

  describe('read-only topologies', () => {
    beforeEach(() => {
      topologyStore.isEditable = false;
      open();
    });

    it('is read-only if the user can not edit it', () => {
      expect(manager.isReadOnly).toBe(true);
      expect(doc.capabilities.readOnly).toBe(true);
    });

    it('ignores edits from the graph', () => {
      manager.renameNode('r1', 'r3');
      manager.addShape({shapeType: 'rectangle', position: {x: 0, y: 0}});
      manager.deleteElements(['r1'], [], [], []);

      expect(doc.history.length).toBe(1);
      expect(manager.topology!.definition.nodeNames).toContain('r1');
    });

    it('can not be cleared', () => {
      manager.clear();

      expect(doc.history.length).toBe(1);
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

      expect(doc.history.length).toBe(1);
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
      (bed.deviceStore as {data: unknown}).data = undefined;
      open();
      manager.connectNodes('r1', 'pc');

      expect(doc.history.length).toBe(1);
    });

    it('clears all nodes and links of a topology', () => {
      open();
      manager.clear();

      const {definition, annotations} = manager.topology!;
      expect(definition.nodeNames).toEqual([]);
      expect(definition.links).toEqual([]);
      expect(annotations.nodeAnnotations).toEqual([]);
      expect(doc.isEdited).toBe(true);
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

      expect(doc.history.length).toBe(2);
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
      expect(doc.history.length).toBe(2);

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

      expect(doc.history.length).toBe(1);
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
      // Adding the text and writing it are one change
      expect(doc.history.length).toBe(2);
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

      expect(doc.history.length).toBe(2);

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
      type(LABELED.replace('name: test', 'name: x'));

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
      type(TOPOLOGY.replace('name: test', 'name: saved'));
      await doc.save();

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
      await doc.save();

      const body = topologyStore.updates[0].body;
      expect(JSON.parse(body.annotations!).nodeAnnotations[0].position).toEqual(
        {x: 7, y: 7},
      );
    });

    it('has no edits after a successful save', async () => {
      open();
      manager.renameNode('pc', 'client');
      await doc.save();

      expect(doc.isEdited).toBe(false);
      expect(
        topologyStore.lookup.get('topology-id')!.definition.nodeNames,
      ).toContain('client');
    });

    it('keeps the edits if saving fails', async () => {
      topologyStore.updateResult = Result.createErr({code: 500, message: ''});
      open();
      manager.renameNode('pc', 'client');
      const result = await doc.save();

      expect(result.isErr()).toBe(true);
      expect(doc.isEdited).toBe(true);
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
      await doc.save();

      const saved = JSON.parse(topologyStore.updates[0].body.annotations!);
      expect(saved.nodeAnnotations.map((a: {id: string}) => a.id)).toEqual([
        'r1',
        'r2',
        'pc',
      ]);
    });
  });
});
