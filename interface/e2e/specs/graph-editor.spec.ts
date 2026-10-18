import {Annotations} from '../fixtures/api';
import {expect, test, Topology} from '../fixtures/test';
import {
  graphEdges,
  graphNodes,
  graphZoom,
  nodeModelPosition,
  Position,
} from '../helpers/cytoscape';
import {ConfirmDialog, Dialog, menuItem} from '../pages/dialogs';
import {EditorPage} from '../pages/editor-page';
import {GraphEditor} from '../pages/graph';

/*
 * The graph editor: nodes and links, and the annotations drawn around them (groups, rectangles,
 * ellipses, lines and texts). Every change is checked in the annotations the server stores after saving,
 * which is what other tools such as containerlab's VS Code extension read.
 */

/** Opens a topology in the graph-only view and waits until all its nodes are drawn. */
async function openGraph(
  page: import('@playwright/test').Page,
  topology: Topology,
): Promise<{editor: EditorPage; graph: GraphEditor}> {
  const editor = new EditorPage(page);
  await editor.open(topology.id, topology.name);
  await editor.editor.view('Graph').click();
  await editor.graph.waitForNodes(topology.nodes.length);
  return {editor, graph: editor.graph};
}

/** A spot on the canvas below the nodes with room for a drawing of the given size. */
async function freeArea(
  graph: GraphEditor,
  nodes: string[],
  size = {width: 160, height: 100},
): Promise<{from: Position; to: Position}> {
  const canvas = await graph.size();
  let lowest = 0;
  for (const node of nodes) {
    lowest = Math.max(lowest, (await graph.nodeAt(node)).y);
  }
  // A node reaches about 60 graph units below its centre, with its label
  const below = 100 * (await graphZoom(graph.canvas));
  const top = Math.min(lowest + below, canvas.height - size.height - 20);
  // Right of the graph toolbar, which floats over the left edge of the canvas
  const left = 140;
  return {
    from: {x: left, y: top},
    to: {x: left + size.width, y: top + size.height},
  };
}

/** Saves and returns the annotations the server has now. */
async function saveAndRead(
  editor: EditorPage,
  api: {getAnnotations: (id: string) => Promise<Annotations>},
  topologyId: string,
  check: (annotations: Annotations) => boolean,
): Promise<Annotations> {
  await editor.editor.save.click();
  await expect(editor.editor.unsavedDot).toBeHidden();
  let annotations: Annotations = {};
  await expect
    .poll(async () => {
      annotations = await api.getAnnotations(topologyId);
      return check(annotations);
    })
    .toBe(true);
  return annotations;
}

test.describe('nodes and links', () => {
  test('a node can be added with the dialog', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);

    await graph.tool('Add node').click();
    const dialog = new Dialog(page, 'Add node');
    await dialog.fill('Name', 'router9');
    await dialog.select('Kind', 'linux');
    await dialog.submit('Save');

    await expect.poll(() => graphNodes(graph.canvas)).toContain('router9');
    await editor.editor.save.click();
    await expect
      .poll(async () => (await api.getTopology(topology.id)).definition)
      .toMatch(/router9:\s*\n\s*kind: linux/);
    const annotations = await api.getAnnotations(topology.id);
    expect(annotations.nodeAnnotations?.map(n => n.id)).toContain('router9');
  });

  test('a node needs a name and a kind', async ({page, createTopology}) => {
    const topology = await createTopology();
    const {graph} = await openGraph(page, topology);

    await graph.tool('Add node').click();
    const dialog = new Dialog(page, 'Add node');
    await dialog.submit('Save');

    await expect(dialog.validationError()).toBeVisible();
    await expect(dialog.root).toBeVisible();
  });

  test('double-clicking a node edits it', async ({page, createTopology}) => {
    const topology = await createTopology();
    const {graph} = await openGraph(page, topology);

    await graph.clickNode('host1', {clickCount: 2});

    const dialog = new Dialog(page, 'Edit node');
    await expect(dialog.field('Name')).toHaveValue('host1');
  });

  test('a node can be renamed in place', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);

    await graph.nodeMenu('host1', 'Rename');
    await graph.labelEditor.fill('core1');
    await graph.labelEditor.press('Enter');

    await expect.poll(() => graphNodes(graph.canvas)).toContain('core1');
    // Links follow the renamed node
    await expect
      .poll(() => graphEdges(graph.canvas))
      .toEqual([['core1', 'host2']]);
    await editor.editor.save.click();
    await expect
      .poll(async () => (await api.getTopology(topology.id)).definition)
      .toContain('"core1:eth1"');
  });

  test('a node name must be unique', async ({page, createTopology}) => {
    const topology = await createTopology();
    const {graph} = await openGraph(page, topology);

    await graph.nodeMenu('host1', 'Rename');
    await graph.labelEditor.fill('host2');
    await graph.labelEditor.press('Enter');

    await expect(page.getByText('host2 already exists')).toBeVisible();
  });

  test('two nodes can be connected', async ({page, api, createTopology}) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {editor, graph} = await openGraph(page, topology);

    await graph.nodeMenu('a', 'Connect');
    await graph.clickNode('c');

    await expect
      .poll(() => graphEdges(graph.canvas))
      .toContainEqual(['a', 'c']);
    await editor.editor.save.click();
    await expect
      .poll(async () => (await api.getTopology(topology.id)).definition)
      .toMatch(/a:eth2"?[\s\S]{0,20}c:eth2/);
  });

  test('a node can be connected to itself with two interfaces', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);

    await graph.nodeMenu('host1', 'Connect');
    await graph.clickNode('host1');

    await expect
      .poll(() => graphEdges(graph.canvas))
      .toContainEqual(['host1', 'host1']);
    await editor.editor.save.click();
    // host1:eth1 is taken by the link to host2, so the loop gets the next two
    await expect
      .poll(async () => (await api.getTopology(topology.id)).definition)
      .toMatch(/host1:eth2"?[\s\S]{0,20}host1:eth3/);
  });

  test('a node can be deleted with the Delete key', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {editor, graph} = await openGraph(page, topology);

    await graph.clickNode('c');
    await graph.press('Delete');

    await expect.poll(() => graphNodes(graph.canvas)).toEqual(['a', 'b']);
    // Its link is gone too
    await expect.poll(() => graphEdges(graph.canvas)).toEqual([['a', 'b']]);
    await editor.editor.save.click();
    await expect
      .poll(async () => (await api.getTopology(topology.id)).definition)
      .not.toContain('c:');
  });

  test('deleting the last link leaves a topology that can be saved', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);

    await graph.clickNode('host2');
    await graph.press('Delete');
    await graph.waitForNodes(1);

    await expect(editor.editor.validation).toHaveAttribute(
      'data-validation-state',
      'done',
    );
    await editor.editor.save.click();
    await expect
      .poll(async () => (await api.getTopology(topology.id)).definition)
      .not.toContain('host2');
    // Without links, there's no `links` key left (an empty list isn't allowed)
    expect((await api.getTopology(topology.id)).definition).not.toContain(
      'links',
    );
  });

  test('a link can be deleted from its menu', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {editor, graph} = await openGraph(page, topology);

    const {rightClickGraphEdge} = await import('../helpers/cytoscape');
    await rightClickGraphEdge(graph.canvas, ['a', 'b']);
    await menuItem(page, 'Delete link').click();

    await expect.poll(() => graphEdges(graph.canvas)).toEqual([['b', 'c']]);
    await editor.editor.save.click();
    await expect
      .poll(async () => (await api.getTopology(topology.id)).definition)
      .not.toContain('a:eth1');
  });

  test('a dragged node keeps its new position after saving', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const before = (await nodeModelPosition(graph.canvas, 'host1'))!;
    const at = await graph.nodeAt('host1');

    await graph.drag(at, {x: at.x, y: at.y + 120});

    const after = (await nodeModelPosition(graph.canvas, 'host1'))!;
    expect(after.y).toBeGreaterThan(before.y + 50);
    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.nodeAnnotations?.find(n => n.id === 'host1')?.position?.y !== 300,
    );
    const stored = annotations.nodeAnnotations!.find(n => n.id === 'host1')!;
    expect(stored.position!.y).toBeCloseTo(after.y, -1);
  });

  test('clearing the graph removes all nodes and links', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);

    await graph.tool('Clear graph').click();

    await expect.poll(() => graphNodes(graph.canvas)).toEqual([]);
    await expect.poll(() => graphEdges(graph.canvas)).toEqual([]);
    // It can be undone, and Save stores nothing until the user decides
    await expect(editor.editor.title).toHaveText(
      new RegExp(`${topology.name}\\*$`),
    );
    await editor.editor.undo.click();
    await expect.poll(() => graphNodes(graph.canvas)).toHaveLength(2);
  });
});

test.describe('groups', () => {
  test('selected nodes can be grouped with Ctrl+G', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {editor, graph} = await openGraph(page, topology);

    await graph.clickNode('a');
    await graph.clickNode('b', {modifiers: ['Shift']});
    await graph.press('ControlOrMeta+G');

    await expect(graph.groups()).toHaveCount(1);
    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => (a.groupStyleAnnotations?.length ?? 0) === 1,
    );
    const group = annotations.groupStyleAnnotations![0];
    const member = (id: string) =>
      annotations.nodeAnnotations!.find(n => n.id === id)?.groupId;
    expect(member('a')).toBe(group.id);
    expect(member('b')).toBe(group.id);
    expect(member('c')).toBeUndefined();
  });

  test('a group can be drawn around nodes and renamed', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const a = await graph.nodeAt('host1');
    const b = await graph.nodeAt('host2');

    await graph.draw(
      'Group',
      {x: Math.min(a.x, b.x) - 60, y: Math.min(a.y, b.y) - 60},
      {x: Math.max(a.x, b.x) + 60, y: Math.max(a.y, b.y) + 70},
    );

    await expect(graph.groups()).toHaveCount(1);
    // Drawing a group starts renaming it
    await expect(graph.labelEditor).toBeVisible();
    await graph.labelEditor.fill('Backbone');
    await graph.labelEditor.press('Enter');

    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      x => x.groupStyleAnnotations?.[0]?.name === 'Backbone',
    );
    const group = annotations.groupStyleAnnotations![0];
    expect(
      annotations
        .nodeAnnotations!.filter(n => n.groupId === group.id)
        .map(n => n.id)
        .sort(),
    ).toEqual(['host1', 'host2']);
  });

  test('ungrouping keeps the nodes', async ({page, api, createTopology}) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    await graph.press('Escape');
    await graph.clickNode('host1');
    await graph.clickNode('host2', {modifiers: ['Shift']});
    await graph.press('ControlOrMeta+G');
    await expect(graph.groups()).toHaveCount(1);

    // Grouping starts renaming the new group; Escape ends that. Ungrouping works on the selected group.
    await graph.press('Escape');
    const id = await graph.groups().first().getAttribute('data-layer-id');
    await graph.clickLayer(id!);
    await graph.press('Control+Shift+g');

    await expect(graph.groups()).toHaveCount(0);
    await expect.poll(() => graphNodes(graph.canvas)).toHaveLength(2);
    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a =>
        (a.groupStyleAnnotations?.length ?? 0) === 0 &&
        !!a.nodeAnnotations?.length,
    );
    expect(annotations.nodeAnnotations!.every(n => !n.groupId)).toBe(true);
  });

  async function groupNodes(graph: GraphEditor, names: string[]) {
    await graph.clickNode(names[0]);
    for (const name of names.slice(1)) {
      await graph.clickNode(name, {modifiers: ['Shift']});
    }
    await graph.press('ControlOrMeta+G');
    // Grouping starts renaming the new group; Escape ends that
    await graph.press('Escape');
    return (await graph.groups().first().getAttribute('data-layer-id'))!;
  }

  test('"Delete group and nodes" deletes the nodes of the group', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {editor, graph} = await openGraph(page, topology);
    const id = await groupNodes(graph, ['a', 'b']);

    await graph.layerMenu(id, 'Delete group and nodes');

    await expect(graph.groups()).toHaveCount(0);
    await expect.poll(() => graphNodes(graph.canvas)).toEqual(['c']);
    // The nodes are gone from the definition too
    expect(await editor.editor.text()).not.toMatch(/^\s+(a|b):/m);
  });

  test("the group bar's delete button deletes the group and its nodes", async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {graph} = await openGraph(page, topology);
    const id = await groupNodes(graph, ['a', 'b']);
    await graph.clickLayer(id);

    await graph.barButton('Delete').click();

    await expect(graph.groups()).toHaveCount(0);
    await expect.poll(() => graphNodes(graph.canvas)).toEqual(['c']);
  });

  test('the Delete key deletes only the group and keeps its nodes', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {graph} = await openGraph(page, topology);
    const id = await groupNodes(graph, ['a', 'b']);
    await graph.clickLayer(id);

    await graph.press('Delete');

    await expect(graph.groups()).toHaveCount(0);
    await expect
      .poll(async () => (await graphNodes(graph.canvas)).sort())
      .toEqual(['a', 'b', 'c']);
  });
});

test.describe('shapes and lines', () => {
  test('a rectangle can be drawn and is stored as an annotation', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);

    await graph.draw('Rectangle', area.from, area.to);

    await expect(graph.shapes()).toHaveCount(1);
    // The tool goes back to Select and the new shape is selected, with its style bar
    await expect(graph.tool('Select')).toHaveClass(/toggled/);
    await expect(graph.barButton('Fill')).toBeVisible();
    await expect(editor.editor.stats).toContainText('1 annotation');

    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.length === 1,
    );
    const shape = annotations.freeShapeAnnotations![0];
    expect(shape.shapeType).toBe('rectangle');
    const zoom = await graphZoom(graph.canvas);
    expect(shape.width).toBeCloseTo(160 / zoom, -1);
    expect(shape.height).toBeCloseTo(100 / zoom, -1);

    // It's still there after a reload
    await page.reload();
    await editor.editor.waitForTitle(topology.name);
    await expect(graph.shapes()).toHaveCount(1);
  });

  test('an ellipse can be drawn and changed into a rectangle', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);

    await graph.draw('Ellipse', area.from, area.to);
    await expect(graph.shapes()).toHaveCount(1);
    const id = await graph.shapes().first().getAttribute('data-layer-id');

    await graph.layerMenu(id!, 'Change to rectangle');

    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.[0]?.shapeType === 'rectangle',
    );
    expect(annotations.freeShapeAnnotations).toHaveLength(1);
  });

  test('a line can be drawn and gets arrows', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes, {width: 200, height: 0});

    await graph.draw('Line', area.from, area.to);

    await expect(graph.lines()).toHaveCount(1);
    // New lines have an arrow at the end only
    await expect(graph.barButton('Arrow at the end')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await graph.barButton('Arrow at the start').click();
    await expect(graph.barButton('Arrow at the start')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.[0]?.lineStartArrow === true,
    );
    const line = annotations.freeShapeAnnotations![0];
    expect(line.shapeType).toBe('line');
    expect(line.lineEndArrow).toBe(true);
    expect(line.endPosition!.x).toBeGreaterThan(line.position.x);
  });

  test('a line can be reversed', async ({page, api, createTopology}) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes, {width: 200, height: 0});
    await graph.draw('Line', area.from, area.to);
    await expect(graph.lines()).toHaveCount(1);
    // Without the selection, its handles don't cover the line
    await graph.press('Escape');
    // Right-click the middle of the line, as stored
    const stored = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.length === 1,
    );
    const line = stored.freeShapeAnnotations![0];
    await graph.clickAtGraph(
      {
        x: (line.position.x + line.endPosition!.x) / 2,
        y: (line.position.y + line.endPosition!.y) / 2,
      },
      {button: 'right'},
    );
    await menuItem(page, 'Reverse direction').click();

    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a =>
        !!a.freeShapeAnnotations?.[0]?.endPosition &&
        a.freeShapeAnnotations[0].endPosition.x <
          a.freeShapeAnnotations[0].position.x,
    );
    expect(annotations.freeShapeAnnotations).toHaveLength(1);
  });

  test('the fill of a shape can be changed', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);
    await graph.draw('Rectangle', area.from, area.to);

    await graph.barButton('Fill').click();
    const popover = page.locator('.p-overlaypanel').filter({visible: true});
    await popover
      .getByRole('option', {name: 'No color'})
      .dispatchEvent('mousedown');

    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.[0]?.fillColor === 'transparent',
    );
    expect(annotations.freeShapeAnnotations).toHaveLength(1);
  });

  test('shapes can be deleted, duplicated and reordered', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);
    await graph.draw('Rectangle', area.from, area.to);
    await expect(graph.shapes()).toHaveCount(1);

    // Duplicate the selected shape
    await graph.press('ControlOrMeta+D');
    await expect(graph.shapes()).toHaveCount(2);

    // The copy is selected and on top; send it to the back
    await graph.press('ControlOrMeta+Shift+[');
    let annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.length === 2,
    );
    const [first, second] = annotations.freeShapeAnnotations!;
    const copy = [first, second].sort((x, y) => y.position.x - x.position.x)[0];
    const original = copy === first ? second : first;
    expect(copy.zIndex ?? 0).toBeLessThan(original.zIndex ?? 0);

    // Delete it with the selection bar
    await graph.barButton('Delete').click();
    await expect(graph.shapes()).toHaveCount(1);
    annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.length === 1,
    );
    expect(annotations.freeShapeAnnotations![0].id).toBe(original.id);
  });

  test('arrow keys move the selected shape', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);
    await graph.draw('Rectangle', area.from, area.to);
    let annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.length === 1,
    );
    const before = annotations.freeShapeAnnotations![0].position;

    // Keys go to the graph after a click in it, not after clicking Save
    await graph.clickLayer(annotations.freeShapeAnnotations![0].id);
    await graph.press('ArrowRight');
    await graph.press('Shift+ArrowDown');

    annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeShapeAnnotations?.[0]?.position.x !== before.x,
    );
    const after = annotations.freeShapeAnnotations![0].position;
    expect(after.x - before.x).toBeCloseTo(5, 0);
    expect(after.y - before.y).toBeCloseTo(35, 0);
  });

  test('drawing a shape can be undone', async ({page, createTopology}) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);
    await graph.draw('Rectangle', area.from, area.to);
    await expect(graph.shapes()).toHaveCount(1);

    // The editor's undo listens for a lowercase z
    await graph.press('Control+z');

    await expect(graph.shapes()).toHaveCount(0);
    await graph.press('Control+y');
    await expect(graph.shapes()).toHaveCount(1);
    await expect(editor.editor.redo).toBeDisabled();
  });
});

test.describe('texts', () => {
  test('a markdown text can be written on the canvas', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {editor, graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);

    await graph.tool('Text').click();
    await graph.clickAt(area.from);
    await expect(graph.textEditor).toBeFocused();
    await page.keyboard.type('**Area 0** backbone');
    await page.keyboard.press('Escape');

    const text = graph.texts().first();
    await expect(text.locator('.sb-graph-text-content strong')).toHaveText(
      'Area 0',
    );
    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeTextAnnotations?.length === 1,
    );
    expect(annotations.freeTextAnnotations![0].text).toBe(
      '**Area 0** backbone',
    );
  });

  test('an empty text is removed when editing ends', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);

    await graph.tool('Text').click();
    await graph.clickAt(area.from);
    await expect(graph.textEditor).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(graph.texts()).toHaveCount(0);
  });

  test('a text can be edited again and styled', async ({
    page,
    api,
    createTopology,
  }) => {
    const topology = await createTopology({
      annotations: JSON.stringify({
        nodeAnnotations: [
          {id: 'host1', position: {x: 150, y: 300}},
          {id: 'host2', position: {x: 350, y: 300}},
        ],
        freeTextAnnotations: [
          {
            id: 'text-1',
            text: 'Old',
            position: {x: 150, y: 450},
            width: 240,
            height: 60,
          },
        ],
      }),
    });
    const {editor, graph} = await openGraph(page, topology);
    await expect(graph.texts()).toHaveCount(1);

    await graph.clickLayer('text-1');
    await graph.barButton('Align center').click();
    await graph.press('Enter');
    await expect(graph.textEditor).toBeFocused();
    await graph.textEditor.fill('New');
    await page.keyboard.press('Escape');

    const annotations = await saveAndRead(
      editor,
      api,
      topology.id,
      a => a.freeTextAnnotations?.[0]?.text === 'New',
    );
    expect(annotations.freeTextAnnotations![0].textAlign).toBe('center');
  });
});

test.describe('selection and view', () => {
  test('Escape deselects and Ctrl+A selects everything', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {graph} = await openGraph(page, topology);

    // Nothing is selected after Escape, so Delete does nothing
    await graph.clickNode('a');
    await graph.press('Escape');
    await graph.press('Delete');
    await graph.waitForNodes(3);

    await graph.press('ControlOrMeta+A');
    await graph.press('Delete');
    await graph.waitForNodes(0);
  });

  test('dragging on the empty canvas selects the nodes inside', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology({nodes: ['a', 'b', 'c']});
    const {graph} = await openGraph(page, topology);
    const a = await graph.nodeAt('a');
    const b = await graph.nodeAt('b');

    await graph.drag(
      {x: Math.min(a.x, b.x) - 50, y: Math.min(a.y, b.y) - 50},
      {x: Math.max(a.x, b.x) + 30, y: Math.max(a.y, b.y) + 50},
    );

    await graph.press('Delete');
    await expect.poll(() => graphNodes(graph.canvas)).toEqual(['c']);
  });

  test('the zoom control zooms in and resets', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {graph} = await openGraph(page, topology);
    const before = await graphZoom(graph.canvas);

    await page.getByRole('button', {name: 'Zoom in'}).click();
    await expect
      .poll(() => graphZoom(graph.canvas))
      .toBeCloseTo(before * 1.25, 2);

    await page.getByRole('button', {name: 'Zoom out'}).click();
    await expect.poll(() => graphZoom(graph.canvas)).toBeCloseTo(before, 2);

    await graph.zoomLevel.click();
    await expect(graph.zoomLevel).toHaveText('100%');
  });

  test('the background menu adds elements where it was opened', async ({
    page,
    createTopology,
  }) => {
    const topology = await createTopology();
    const {graph} = await openGraph(page, topology);
    const area = await freeArea(graph, topology.nodes);

    await graph.menuAt(area.from, 'Add rectangle');
    await expect(graph.shapes()).toHaveCount(1);

    await graph.menuAt({x: area.from.x + 250, y: area.from.y}, 'Add text');
    await expect(graph.textEditor).toBeFocused();
    await page.keyboard.type('Note');
    await page.keyboard.press('Escape');
    await expect(graph.texts()).toHaveCount(1);
  });
});

test('closing a node dialog with changes asks first', async ({
  page,
  createTopology,
}) => {
  const topology = await createTopology();
  const {graph} = await openGraph(page, topology);
  await graph.clickNode('host1', {clickCount: 2});
  const dialog = new Dialog(page, 'Edit node');
  await dialog.fill('Name', 'changed');

  await dialog.close();

  await expect(new ConfirmDialog(page).root).toContainText(
    'Discard unsaved changes?',
  );
});
