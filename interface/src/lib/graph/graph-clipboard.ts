import {
  Box,
  moveShapeGeometry,
  nodeBox,
  roundPosition,
  shapeBox,
  shapeGeometry,
  storedTextBox,
  unionBox,
} from '@sb/lib/graph/annotation-geometry';
import {
  AnnotationListKey,
  nextAnnotationId,
} from '@sb/lib/graph/topology-annotations';
import {
  FreeShapeAnnotation,
  FreeTextAnnotation,
  GroupStyleAnnotation,
  NodeAnnotation,
  TopologyAnnotations,
  TopologyLink,
} from '@sb/types/domain/topology';
import {Position} from '@sb/types/types';

// Marks text on the clipboard as copied elements of a graph
const CLIPBOARD_MARKER = 'antimony/graph-elements';

export interface ClipboardNode {
  name: string;

  // The definition of the node in the topology
  definition: unknown;
  annotation: NodeAnnotation;
}

/**
 * Copied elements of a graph. Links are only copied between copied nodes, and
 * groups only together with their members.
 */
export interface GraphClipboard {
  marker: typeof CLIPBOARD_MARKER;
  nodes: ClipboardNode[];
  links: TopologyLink[];
  groups: GroupStyleAnnotation[];
  shapes: FreeShapeAnnotation[];
  texts: FreeTextAnnotation[];
}

export function createClipboard(
  content: Omit<GraphClipboard, 'marker'>,
): GraphClipboard {
  return {marker: CLIPBOARD_MARKER, ...content};
}

/**
 * Returns the copied elements in the given text, or null if the text isn't
 * copied from a graph.
 */
export function parseClipboard(text: string): GraphClipboard | null {
  try {
    const content = JSON.parse(text) as Partial<GraphClipboard> | null;
    if (content?.marker !== CLIPBOARD_MARKER) return null;

    return {
      marker: CLIPBOARD_MARKER,
      nodes: content.nodes ?? [],
      links: content.links ?? [],
      groups: content.groups ?? [],
      shapes: content.shapes ?? [],
      texts: content.texts ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Returns the box around all copied elements, or null if nothing was copied.
 */
export function clipboardBox(clipboard: GraphClipboard): Box | null {
  return unionBox([
    ...clipboard.nodes
      .filter(node => node.annotation.position)
      .map(node => nodeBox(node.annotation.position!)),
    ...clipboard.groups.map(group => ({
      ...group.position,
      width: group.width,
      height: group.height,
    })),
    ...clipboard.shapes.map(shape => shapeBox(shapeGeometry(shape))),
    ...clipboard.texts.map(storedTextBox),
  ]);
}

/**
 * Copied elements that are ready to be added to a topology.
 */
export interface PastedElements {
  nodes: ClipboardNode[];
  links: TopologyLink[];
  groups: GroupStyleAnnotation[];
  shapes: FreeShapeAnnotation[];
  texts: FreeTextAnnotation[];
}

/**
 * Prepares copied elements to be added to a topology. Nodes whose name is taken
 * get the next free number, groups, shapes and texts get new IDs, and all
 * elements are moved by the given distance.
 *
 * @param clipboard The copied elements.
 * @param nodeNames The names of the nodes of the topology.
 * @param annotations The annotations of the topology.
 * @param delta The distance the elements are moved by.
 */
export function pasteClipboard(
  clipboard: GraphClipboard,
  nodeNames: string[],
  annotations: TopologyAnnotations,
  delta: Position,
): PastedElements {
  const takenNames = new Set(nodeNames);
  const names = new Map<string, string>();

  for (const node of clipboard.nodes) {
    const name = nextFreeName(node.name, takenNames);
    takenNames.add(name);
    names.set(node.name, name);
  }

  const groupIds = newIds(
    clipboard.groups,
    annotations,
    'groupStyleAnnotations',
    'group',
  );
  const shapeIds = newIds(
    clipboard.shapes,
    annotations,
    'freeShapeAnnotations',
    'shape',
  );
  const textIds = newIds(
    clipboard.texts,
    annotations,
    'freeTextAnnotations',
    'text',
  );

  const move = (position: Position) =>
    roundPosition({x: position.x + delta.x, y: position.y + delta.y});

  return {
    nodes: clipboard.nodes.map(node => ({
      ...node,
      name: names.get(node.name)!,
      annotation: {
        ...node.annotation,
        id: names.get(node.name)!,
        position: node.annotation.position
          ? move(node.annotation.position)
          : undefined,
        groupId: node.annotation.groupId
          ? groupIds.get(node.annotation.groupId)
          : undefined,
      },
    })),
    links: clipboard.links.map(link => ({
      ...link,
      endpoints: link.endpoints.map(endpoint => {
        const [nodeName, interfaceName] = endpoint.split(':');
        return `${names.get(nodeName) ?? nodeName}:${interfaceName}`;
      }),
    })),
    groups: clipboard.groups.map(group => ({
      ...group,
      id: groupIds.get(group.id)!,
      position: move(group.position),
    })),
    shapes: clipboard.shapes.map(shape => ({
      ...shape,
      ...moveShapeGeometry(shapeGeometry(shape), delta),
      id: shapeIds.get(shape.id)!,
    })),
    texts: clipboard.texts.map(text => ({
      ...text,
      id: textIds.get(text.id)!,
      position: move(text.position),
    })),
  };
}

/**
 * Returns the given name if it isn't taken, otherwise the name with the next
 * free number, e.g. srl3 for srl1 if srl1 and srl2 exist.
 */
export function nextFreeName(name: string, takenNames: Set<string>): string {
  if (!takenNames.has(name)) return name;

  const [, base, digits] = /^(.*?)(\d*)$/.exec(name)!;
  let number = digits ? Number(digits) + 1 : 1;

  while (takenNames.has(`${base}${number}`)) number++;

  return `${base}${number}`;
}

/**
 * Returns IDs for the given items that aren't used in the list yet, by the
 * current ID of each item.
 */
function newIds(
  items: {id: string}[],
  annotations: TopologyAnnotations,
  key: AnnotationListKey,
  prefix: string,
): Map<string, string> {
  const ids = new Map<string, string>();
  let updatedAnnotations = annotations;

  for (const item of items) {
    const id = nextAnnotationId(updatedAnnotations, key, prefix);
    ids.set(item.id, id);

    // The ID is taken for the next item
    updatedAnnotations = {
      ...updatedAnnotations,
      [key]: [...(updatedAnnotations[key] ?? []), {id}],
    };
  }

  return ids;
}
