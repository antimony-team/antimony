import {positionLabels} from '../fixtures/api';
import {expect, test} from '../fixtures/test';
import {
  clickGraphNode,
  dragOnGraph,
  graphEdges,
  graphGroups,
  graphNodes,
  nodePosition,
  rightClickGraphEdge,
} from '../helpers/cytoscape';
import {editorText} from '../helpers/monaco';
import {Dialog} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';

/** Opens a topology in the editor and waits until its graph is drawn. */
async function openTopology(
  editor: EditorPage,
  topologyId: string,
  nodes: string[],
) {
  await editor.goto(topologyId);
  await expect
    .poll(() => graphNodes(editor.nodeEditor.graph))
    .toEqual(expect.arrayContaining(nodes));
}

test.describe('node editor', () => {
  test('a node can be added', async ({page, api, createTopology}) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1']);

    await editor.nodeEditor.button('Add Node').click();
    const dialog = new Dialog(page, 'Add Node');
    await dialog.fill('Name', 'router1');
    await dialog.select('Kind', 'linux');
    await dialog.button('Save').click();

    await expect(dialog.root).toBeHidden();
    await expect
      .poll(() => graphNodes(editor.nodeEditor.graph))
      .toContain('router1');
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('router1:');

    // The node editor only edits the topology in the editor; saving stores it
    await editor.editor.save();
    await expect(editor.editor.unsavedBadge).toBeHidden();
    expect((await api.getTopology(topology.id)).definition).toContain(
      'router1:',
    );
  });

  test('a node needs a name', async ({page, createTopology}) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1']);

    await editor.nodeEditor.button('Add Node').click();
    const dialog = new Dialog(page, 'Add Node');
    await dialog.button('Save').click();

    await expect(dialog.validationError()).toHaveText("Name can't be empty");
  });

  test('a node can be renamed by double-clicking it', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1']);

    await clickGraphNode(editor.nodeEditor.graph, 'host1', {clickCount: 2});
    const dialog = new Dialog(page, 'Edit Node');
    await expect(dialog.field('Name')).toHaveValue('host1');
    await dialog.fill('Name', 'server1');
    await dialog.button('Save').click();

    await expect
      .poll(() => graphNodes(editor.nodeEditor.graph))
      .toEqual(['server1']);
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('server1:');
  });

  test('two nodes can be connected', async ({page, createTopology}) => {
    test.fail(
      true,
      'Known bug: the dashed ghost edge drawn to the cursor catches the click on the target ' +
        'node, which cancels the connection (.ghost-edge has no `events: no` style)',
    );

    const topology = await createTopology({nodes: ['host1', 'host2']});
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1', 'host2']);

    await clickGraphNode(editor.nodeEditor.graph, 'host1', {button: 'right'});
    await editor.nodeEditor.contextMenuItem('Connect').click();
    await clickGraphNode(editor.nodeEditor.graph, 'host2');

    await expect
      .poll(async () =>
        (await graphEdges(editor.nodeEditor.graph)).map(edge => edge.sort()),
      )
      .toEqual([['host1', 'host2']]);
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toMatch(/host1:eth1.*host2:eth1/s);
  });

  test('connecting nodes of different kinds uses the right interface names', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    test.fail(
      true,
      "Known bug: connectNodes derives the target's interface from the source node's kind. " +
        'Currently not reachable through the UI, because connecting fails earlier (see above)',
    );

    const collection = await createCollection();
    const topologyId = await api.createTopology(
      collection.id,
      `name: ${uniqueName('topology')}\ntopology:\n  nodes:\n` +
        '    host1:\n      kind: linux\n      image: alpine:latest\n' +
        positionLabels(0) +
        '    srl1:\n      kind: nokia_srlinux\n      image: ghcr.io/nokia/srlinux\n' +
        positionLabels(1),
    );
    const editor = new EditorPage(page);
    await openTopology(editor, topologyId, ['host1', 'srl1']);

    await clickGraphNode(editor.nodeEditor.graph, 'host1', {button: 'right'});
    await editor.nodeEditor.contextMenuItem('Connect').click();
    await clickGraphNode(editor.nodeEditor.graph, 'srl1');

    // SR Linux interfaces are named e1-1, e1-2, ... (see the device config)
    await expect
      .poll(() => editorText(editor.editor.monaco), {timeout: 3_000})
      .toMatch(/host1:eth1.*srl1:e1-1/s);
  });

  test('a node can be deleted', async ({page, createTopology}) => {
    const topology = await createTopology({nodes: ['host1', 'host2']});
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1', 'host2']);

    await clickGraphNode(editor.nodeEditor.graph, 'host2', {button: 'right'});
    await editor.nodeEditor.contextMenuItem('Delete').click();

    await expect
      .poll(() => graphNodes(editor.nodeEditor.graph))
      .toEqual(['host1']);
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .not.toContain('host2');
  });

  test('a link can be deleted', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    const collection = await createCollection();
    const topologyId = await api.createTopology(
      collection.id,
      `name: ${uniqueName('topology')}\ntopology:\n  nodes:\n` +
        '    host1:\n      kind: linux\n      image: alpine:latest\n' +
        positionLabels(0) +
        '    host2:\n      kind: linux\n      image: alpine:latest\n' +
        positionLabels(1) +
        '  links:\n    - endpoints: ["host1:eth1", "host2:eth1"]\n',
    );
    const editor = new EditorPage(page);
    await openTopology(editor, topologyId, ['host1', 'host2']);
    await expect
      .poll(() => graphEdges(editor.nodeEditor.graph))
      .toHaveLength(1);

    await rightClickGraphEdge(editor.nodeEditor.graph);
    await editor.nodeEditor.contextMenuItem('Delete').click();

    await expect.poll(() => graphEdges(editor.nodeEditor.graph)).toEqual([]);
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .not.toContain('host1:eth1');
  });

  test('nodes can be grouped by drawing around them', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['host1', 'host2']});
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1', 'host2']);
    const graph = editor.nodeEditor.graph;

    // Draw a rectangle around both nodes
    const first = (await nodePosition(graph, 'host1'))!;
    const second = (await nodePosition(graph, 'host2'))!;
    const margin = 60;

    await editor.nodeEditor.button('Group Nodes').click();
    await dragOnGraph(
      graph,
      {
        x: Math.min(first.x, second.x) - margin,
        y: Math.min(first.y, second.y) - margin,
      },
      {
        x: Math.max(first.x, second.x) + margin,
        y: Math.max(first.y, second.y) + margin,
      },
    );

    const dialog = new Dialog(page, 'Set Group Label');
    await dialog.field('Group Name').fill('backbone');
    await dialog.button('Ok').click();

    await expect
      .poll(() => graphGroups(graph))
      .toEqual({host1: 'backbone', host2: 'backbone'});
    await expect
      .poll(() => editorText(editor.editor.monaco))
      .toContain('backbone');
  });

  test('the graph can be cleared', async ({page, createTopology}) => {
    const topology = await createTopology({nodes: ['host1', 'host2']});
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1', 'host2']);

    await editor.nodeEditor.button('Clear Graph').click();

    await expect.poll(() => graphNodes(editor.nodeEditor.graph)).toEqual([]);
    await expect(editor.editor.unsavedBadge).toBeVisible();
  });

  test('fitting the graph brings all nodes into view', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['host1', 'host2', 'host3']});
    const editor = new EditorPage(page);
    await openTopology(editor, topology.id, ['host1', 'host2', 'host3']);
    const graph = editor.nodeEditor.graph;
    const box = (await graph.boundingBox())!;

    const allInView = async () => {
      for (const node of ['host1', 'host2', 'host3']) {
        const {x, y} = (await nodePosition(graph, node))!;
        if (x < 0 || y < 0 || x > box.width || y > box.height) return false;
      }
      return true;
    };

    // Zoom far in, so some nodes leave the view. Each wheel step zooms by about 5%.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, -300);
    await expect.poll(allInView).toBe(false);

    await editor.nodeEditor.button('Fit Graph').click();

    await expect.poll(allInView).toBe(true);
  });

  test('nodes without stored positions are spread out', async ({
    page,
    api,
    createCollection,
    uniqueName,
  }) => {
    test.fail(
      true,
      'Known bug: nodes without graph-posX/graph-posY labels are all drawn at (0, 0), ' +
        'stacked under the node toolbar',
    );

    // E.g. a topology written by hand, synced from git or uploaded through the API
    const collection = await createCollection();
    const topologyId = await api.createTopology(
      collection.id,
      `name: ${uniqueName('topology')}\ntopology:\n  nodes:\n` +
        '    host1:\n      kind: linux\n      image: alpine:latest\n' +
        '    host2:\n      kind: linux\n      image: alpine:latest\n',
    );
    const editor = new EditorPage(page);
    await openTopology(editor, topologyId, ['host1', 'host2']);

    const first = await nodePosition(editor.nodeEditor.graph, 'host1');
    const second = await nodePosition(editor.nodeEditor.graph, 'host2');
    expect(first).not.toEqual(second);
  });
});
