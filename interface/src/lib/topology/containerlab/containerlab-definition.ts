import {
  Alias,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  Pair,
  YAMLMap,
  YAMLSeq,
} from 'yaml';

import {ContainerlabLink} from '@sb/lib/topology/containerlab/containerlab-link';
import {
  ContainerlabNode,
  NodeParts,
  NodeWriter,
} from '@sb/lib/topology/containerlab/containerlab-node';
import {
  ContainerlabFile,
  ContainerlabLinkDefinition,
  ContainerlabNodeDefinition,
} from '@sb/lib/topology/containerlab/containerlab-types';
import {asDefinition} from '@sb/lib/topology/containerlab/property-rules';
import {
  AddedNode,
  LinkEndpoint,
  TopologyDefinition,
} from '@sb/types/domain/topology-definition';
import {YAMLDocument} from '@sb/types/types';

type ContainerlabDocument = YAMLDocument<ContainerlabFile>;

/**
 * A containerlab topology as containerlab reads it. The nodes and the links
 * are resolved from the document when they are first needed. An edit changes
 * a copy of the document, so comments and the formatting of the rest of the
 * file are kept.
 */
export class ContainerlabDefinition implements TopologyDefinition, NodeWriter {
  public readonly document: ContainerlabDocument;

  // The text of the topology, the one it was read from or the serialized document once it's needed
  private text: string | null;
  private serialized: string | null = null;
  private file: ContainerlabFile | null = null;
  private names: string[] | null = null;
  private resolvedNodes: Map<string, ContainerlabNode> | null = null;
  private resolvedLinks: ContainerlabLink[] | null = null;

  /**
   * @param document The document of the topology.
   * @param text The text the document was read from, if it was read from one.
   */
  constructor(document: ContainerlabDocument, text?: string) {
    this.document = document;
    this.text = text ?? null;
  }

  public get name(): string | undefined {
    const name = this.read().name;
    return typeof name === 'string' ? name : undefined;
  }

  public get nodeNames(): readonly string[] {
    this.names ??= Object.keys(asDefinition(this.read().topology?.nodes) ?? {});
    return this.names;
  }

  public get nodes(): ReadonlyMap<string, ContainerlabNode> {
    if (!this.resolvedNodes) {
      const definitions = this.read().topology ?? {};
      const nodes = asDefinition(definitions.nodes) ?? {};

      this.resolvedNodes = new Map(
        this.nodeNames.map(name => [
          name,
          new ContainerlabNode(
            name,
            asDefinition(nodes[name]),
            nodeParts(this.document, name),
            definitions,
            this,
          ),
        ]),
      );
    }

    return this.resolvedNodes;
  }

  public get links(): readonly ContainerlabLink[] {
    if (!this.resolvedLinks) {
      const links = this.read().topology?.links;

      this.resolvedLinks = Array.isArray(links)
        ? links
            .map((link, index) => ContainerlabLink.read(link, index))
            .filter(link => link !== null)
        : [];
    }

    return this.resolvedLinks;
  }

  // Containerlab renders template actions anywhere in the file, even in comments
  public get isTemplate(): boolean {
    return this.toString().includes('{{');
  }

  public linksOf(nodeName: string): ContainerlabLink[] {
    return this.links.filter(link =>
      link.endpoints.some(endpoint => endpoint.node === nodeName),
    );
  }

  public equals(other: TopologyDefinition): boolean {
    return other instanceof ContainerlabDefinition
      ? this.serialize() === other.serialize()
      : this.toString() === other.toString();
  }

  public toString(): string {
    this.text ??= this.serialize();
    return this.text;
  }

  public setName(name: string): ContainerlabDefinition {
    return this.edit(document => document.set('name', name));
  }

  public renameNode(nodeName: string, newName: string): ContainerlabDefinition {
    if (nodeName === newName) return this;

    return this.edit(document => {
      const nodes = document.getIn(['topology', 'nodes']);
      const node = isMap(nodes)
        ? nodes.items.find(item => keyOf(item) === nodeName)
        : undefined;
      if (!node) return;

      // The node keeps its place and its comments
      if (isScalar(node.key)) {
        node.key.value = newName;
      } else {
        node.key = document.createNode(newName);
      }

      for (const endpoint of endpointNodes(document)) {
        if (isScalar(endpoint) && typeof endpoint.value === 'string') {
          const parsed = parseEndpoint(endpoint.value);
          if (parsed?.node === nodeName) {
            endpoint.value = `${newName}:${parsed.interface}`;
          }
        } else if (isMap(endpoint) && endpoint.get('node') === nodeName) {
          endpoint.set('node', newName);
        }
      }
    });
  }

  public renameInterface(
    linkIndex: number,
    endpointIndex: number,
    interfaceName: string,
  ): ContainerlabDefinition {
    const target = this.links.find(link => link.index === linkIndex)?.endpoints[
      endpointIndex
    ];
    if (!target) return this;

    return this.edit(document => {
      const link = document.getIn(['topology', 'links', linkIndex], true);
      if (!isMap(link)) return;

      // An endpoint keeps the form it's written in
      for (const endpoint of linkEndpoints(link)) {
        if (isScalar(endpoint) && typeof endpoint.value === 'string') {
          const parsed = parseEndpoint(endpoint.value);
          if (isSameEndpoint(parsed, target)) {
            endpoint.value = `${target.node}:${interfaceName}`;
            return;
          }
        } else if (
          isMap(endpoint) &&
          isSameEndpoint(
            {
              node: String(endpoint.get('node')),
              interface: String(endpoint.get('interface')),
            },
            target,
          )
        ) {
          endpoint.set('interface', interfaceName);
          return;
        }
      }
    });
  }

  // Containerlab links connect two named interfaces, they are written in the brief form
  public connect(endpoints: LinkEndpoint[]): ContainerlabDefinition {
    if (
      endpoints.length !== 2 ||
      endpoints.some(endpoint => !endpoint.interface)
    ) {
      return this;
    }

    return this.edit(document => {
      linkSequence(document).add(
        document.createNode({
          endpoints: endpoints.map(
            endpoint => `${endpoint.node}:${endpoint.interface}`,
          ),
        }),
      );
    });
  }

  public deleteNodes(nodeNames: readonly string[]): ContainerlabDefinition {
    const deleted = new Set(nodeNames);
    const linkIndices = this.links
      .filter(link =>
        link.endpoints.some(endpoint => deleted.has(endpoint.node)),
      )
      .map(link => link.index);

    return this.edit(document => {
      for (const nodeName of nodeNames) {
        document.deleteIn(['topology', 'nodes', nodeName]);
      }
      deleteLinkItems(document, linkIndices);
    });
  }

  public deleteLinks(linkIndices: readonly number[]): ContainerlabDefinition {
    return this.edit(document => deleteLinkItems(document, linkIndices));
  }

  public addNodes(
    nodes: readonly AddedNode[],
    links: readonly unknown[],
    names: ReadonlyMap<string, string>,
  ): ContainerlabDefinition {
    return this.edit(document => {
      for (const node of nodes) {
        document.setIn(
          ['topology', 'nodes', node.name],
          document.createNode(node.definition),
        );
      }

      if (links.length === 0) return;

      const sequence = linkSequence(document);
      for (const link of links) {
        const definition = asDefinition(link);
        if (!definition) continue;

        sequence.add(document.createNode(renameLinkNodes(definition, names)));
      }
    });
  }

  /*
   * Writes a value into the node itself. A node without a definition gets one,
   * a node that is an alias of another one merges it and overrides the value,
   * so the anchor stays as it is.
   *
   * A merge key only merges the top level, a nested value is written into a
   * copy of the merged object, so the other values of the object are kept.
   */
  public setNodeValue(
    nodeName: string,
    path: readonly string[],
    value: unknown,
  ): ContainerlabDefinition {
    if (path.length === 0) return this;

    const merged = nodeParts(this.document, nodeName).base?.definition[path[0]];

    return this.edit(document => {
      const node = nodeMap(document, nodeName);

      if (path.length > 1 && !node.has(path[0]) && merged !== undefined) {
        node.set(path[0], document.createNode(merged));
      }

      node.setIn(path, document.createNode(value));
    });
  }

  // Removes a value of the node itself, maps that are empty without it are removed as well
  public resetNodeValue(
    nodeName: string,
    path: readonly string[],
  ): ContainerlabDefinition {
    if (path.length === 0) return this;

    // Merged and inherited values aren't in the node, there is nothing to remove
    const node = this.document.getIn(['topology', 'nodes', nodeName], true);
    if (!isMap(node) || !hasPath(node, path)) return this;

    return this.edit(document => {
      const nodes = document.getIn(['topology', 'nodes'], true) as YAMLMap;
      const node = nodes.get(nodeName, true) as unknown as YAMLMap;

      node.deleteIn(path);

      for (let depth = path.length - 1; depth > 0; depth--) {
        const parent = node.getIn(path.slice(0, depth), true);
        if (!isMap(parent) || parent.items.length > 0) break;

        node.deleteIn(path.slice(0, depth));
      }

      // A node that only merges an anchor again is written as an alias of it
      const [pair] = node.items;
      if (node.items.length === 1 && isMergeKey(pair) && isAlias(pair.value)) {
        nodes.set(nodeName, pair.value);
      }
    });
  }

  private edit(
    change: (document: ContainerlabDocument) => void,
  ): ContainerlabDefinition {
    const document = this.document.clone() as ContainerlabDocument;
    change(document);

    return new ContainerlabDefinition(document);
  }

  private serialize(): string {
    this.serialized ??= this.document.toString({collectionStyle: 'block'});
    return this.serialized;
  }

  private read(): ContainerlabFile {
    this.file ??= this.document.toJS() ?? {};
    return this.file;
  }
}

function keyOf(pair: Pair): string {
  return String(isScalar(pair.key) ? pair.key.value : pair.key);
}

// The map of a node, a node without a definition or that is an alias gets a map of its own
function nodeMap(document: ContainerlabDocument, nodeName: string): YAMLMap {
  if (!isMap(document.getIn(['topology', 'nodes'], true))) {
    document.setIn(['topology', 'nodes'], new YAMLMap());
  }

  const nodes = document.getIn(['topology', 'nodes'], true) as YAMLMap;
  const node = nodes.get(nodeName, true);
  if (isMap(node)) return node;

  const map = new YAMLMap();
  if (isAlias(node)) map.add(document.createPair('<<', node));
  nodes.set(nodeName, map);

  return map;
}

// The values a node sets itself and the ones it merges with merge keys
function nodeParts(
  document: ContainerlabDocument,
  nodeName: string,
): NodeParts {
  const node = document.getIn(['topology', 'nodes', nodeName], true);

  if (isAlias(node)) {
    return {
      own: {},
      base: mergedBase([node], node.toJS(document)),
    };
  }
  if (!isMap(node)) return {own: null, base: null};

  const own = node.clone() as YAMLMap;
  own.items = own.items.filter(pair => !isMergeKey(pair));

  const merges = node.clone() as YAMLMap;
  merges.items = merges.items.filter(pair => isMergeKey(pair));

  return {
    own: asDefinition(own.toJS(document)) ?? {},
    base:
      merges.items.length > 0
        ? mergedBase(
            merges.items.flatMap(pair =>
              isSeq(pair.value) ? pair.value.items : [pair.value],
            ),
            merges.toJS(document),
          )
        : null,
  };
}

// The merged definition, named after the anchors it merges
function mergedBase(
  sources: unknown[],
  definition: unknown,
): NodeParts['base'] {
  const names = sources.map(source =>
    isAlias(source) ? (source as Alias).source : 'merge',
  );

  return {
    name: names.join(', '),
    definition: asDefinition(definition) ?? ({} as ContainerlabNodeDefinition),
  };
}

function isMergeKey(pair: Pair | undefined): pair is Pair {
  return (
    !!pair &&
    isScalar(pair.key) &&
    (typeof pair.key.value === 'symbol' || pair.key.value === '<<')
  );
}

// Whether the map itself has a value at the path, merged values don't count
function hasPath(map: YAMLMap, path: readonly string[]): boolean {
  let current: unknown = map;

  for (const key of path) {
    if (!isMap(current) && !isSeq(current)) return false;

    const collection = current as YAMLMap | YAMLSeq;
    if (!collection.has(key)) return false;
    current = collection.get(key, true);
  }

  return true;
}

function linkSequence(document: ContainerlabDocument): YAMLSeq {
  if (!isSeq(document.getIn(['topology', 'links'], true))) {
    document.setIn(['topology', 'links'], new YAMLSeq());
  }

  return document.getIn(['topology', 'links'], true) as YAMLSeq;
}

function deleteLinkItems(
  document: ContainerlabDocument,
  linkIndices: readonly number[],
) {
  const links = document.getIn(['topology', 'links'], true);
  if (!isSeq(links)) return;

  // From the last one, so the positions of the others don't change
  for (const index of [...new Set(linkIndices)].sort((a, b) => b - a)) {
    links.delete(index);
  }
}

// The endpoints of a link, written as 'node:interface' strings or as maps
function linkEndpoints(link: YAMLMap): unknown[] {
  const endpoints = link.get('endpoints', true);
  const endpoint = link.get('endpoint', true);

  return [
    ...(isSeq(endpoints) ? endpoints.items : []),
    ...(endpoint ? [endpoint] : []),
  ];
}

function endpointNodes(document: ContainerlabDocument): unknown[] {
  const links = document.getIn(['topology', 'links'], true);
  return isSeq(links)
    ? links.items.flatMap(link => (isMap(link) ? linkEndpoints(link) : []))
    : [];
}

// A link with the nodes of its endpoints renamed, each endpoint is written the way it was
function renameLinkNodes(
  link: ContainerlabLinkDefinition,
  names: ReadonlyMap<string, string>,
): ContainerlabLinkDefinition {
  const renamed = (endpoint: unknown): unknown => {
    if (typeof endpoint === 'string') {
      const parsed = parseEndpoint(endpoint);
      return parsed
        ? `${names.get(parsed.node) ?? parsed.node}:${parsed.interface}`
        : endpoint;
    }

    const definition = asDefinition(endpoint);
    if (!definition || typeof definition.node !== 'string') return endpoint;

    return {...definition, node: names.get(definition.node) ?? definition.node};
  };

  return {
    ...link,
    ...(Array.isArray(link.endpoints) && {
      endpoints: link.endpoints.map(renamed),
    }),
    ...(link.endpoint !== undefined && {endpoint: renamed(link.endpoint)}),
  };
}

// A 'node:interface' string is split at its first colon, the interface can contain more
function parseEndpoint(endpoint: string): Required<LinkEndpoint> | null {
  const separator = endpoint.indexOf(':');
  if (separator <= 0) return null;

  return {
    node: endpoint.slice(0, separator),
    interface: endpoint.slice(separator + 1),
  };
}

function isSameEndpoint(
  endpoint: LinkEndpoint | null,
  other: LinkEndpoint,
): boolean {
  return (
    endpoint?.node === other.node && endpoint.interface === other.interface
  );
}
