import {
  ContainerlabDefinitions,
  ContainerlabNodeDefinition as Definition,
} from '@sb/lib/topology/containerlab/containerlab-types';
import {
  asDefinition,
  DEFAULT_RULE,
  isSet,
  LevelValue,
  PROPERTY_RULES,
} from '@sb/lib/topology/containerlab/property-rules';
import {
  NodeProperty,
  PropertySource,
  TopologyDefinition,
  TopologyNode,
} from '@sb/types/domain/topology-definition';

// Writes the values a node sets itself into the file, which returns the edited definition
export interface NodeWriter {
  setNodeValue(
    nodeName: string,
    path: readonly string[],
    value: unknown,
  ): TopologyDefinition;
  resetNodeValue(nodeName: string, path: readonly string[]): TopologyDefinition;
}

/**
 * How a node is written: the values it sets itself and the definition it
 * merges with a merge key, e.g. <<: *anchor. Containerlab reads both as the
 * node's, merged values are only shown as inherited.
 */
export interface NodeParts {
  own: Definition | null;
  base: {name: string; definition: Definition} | null;
}

// A level a node inherits from, with its definition
interface Level {
  source: PropertySource;
  definition: Definition | null;
}

// A resolved value with the level it comes from
interface Resolved {
  value: string;
  source: PropertySource;
}

// Properties that are only read from the node itself, the kind and the group are resolved on their own
const NODE_PROPERTIES = new Set(['mgmt-ipv4', 'mgmt-ipv6', 'aliases']);

/**
 * A node of a containerlab topology. It takes its properties from its group,
 * its kind and the defaults, in that order of precedence after its own. The
 * kind is the device of the node, a node is in a single group at most.
 */
export class ContainerlabNode implements TopologyNode {
  public readonly name: string;
  public readonly device: string | undefined;
  public readonly groups: readonly string[];
  public readonly properties: ReadonlyMap<string, NodeProperty>;

  private readonly parts: NodeParts;
  private readonly definitions: ContainerlabDefinitions;
  private readonly writer: NodeWriter;
  private readonly withoutOwn = new Map<string, ContainerlabNode>();

  /**
   * @param name The name of the node.
   * @param definition The definition of the node with merged values, null if it's written without one.
   * @param parts The values the node sets itself and the ones it merges.
   * @param definitions The definitions the node inherits from.
   * @param writer Writes the values the node sets itself.
   */
  constructor(
    name: string,
    definition: Definition | null,
    parts: NodeParts,
    definitions: ContainerlabDefinitions,
    writer: NodeWriter,
  ) {
    const defaults = asDefinition(definitions.defaults) ?? {};
    const kind = ContainerlabNode.resolveKind(
      definition,
      defaults,
      definitions,
    );
    const kindDefinition = kind
      ? ContainerlabNode.findKind(kind.value, definitions)
      : null;
    const group = ContainerlabNode.resolveGroup(
      definition,
      kindDefinition,
      defaults,
    );
    const groupDefinition = group
      ? asDefinition(definitions.groups?.[group.value])
      : null;

    const levels: Level[] = [
      {source: {level: 'node'}, definition},
      ...(group && groupDefinition
        ? [
            {
              source: {level: 'group', name: group.value} as const,
              definition: groupDefinition,
            },
          ]
        : []),
      ...(kindDefinition
        ? [
            {
              source: {level: 'device', name: kindDefinition.name} as const,
              definition: kindDefinition.definition,
            },
          ]
        : []),
      {source: {level: 'defaults'}, definition: defaults},
    ];

    this.name = name;
    this.parts = parts;
    this.definitions = definitions;
    this.writer = writer;
    this.device = kind?.value;
    this.groups = group ? [group.value] : [];
    this.properties = ContainerlabNode.resolveProperties(
      levels,
      kind,
      group,
      definition,
      parts,
    );
  }

  public get(key: string): unknown {
    return this.properties.get(key)?.value;
  }

  public sourcesOf(key: string): PropertySource[] {
    return this.properties.get(key)?.sources ?? [];
  }

  public isInherited(key: string): boolean {
    const sources = this.sourcesOf(key);
    return (
      sources.length > 0 && sources.every(source => source.level !== 'node')
    );
  }

  public valueAt(path: readonly string[]): unknown {
    if (path.length === 0) {
      return Object.fromEntries(
        [...this.properties].map(([key, property]) => [key, property.value]),
      );
    }

    return valueAt(this.get(path[0]), path.slice(1));
  }

  // The node resolved as if it didn't set the property at the path itself
  public inherited(path: readonly string[]): unknown {
    const key = path[0];
    if (key === undefined || !this.parts.own || !(key in this.parts.own)) {
      return this.valueAt(path);
    }

    let node = this.withoutOwn.get(key);
    if (!node) {
      const own = Object.fromEntries(
        Object.entries(this.parts.own).filter(([ownKey]) => ownKey !== key),
      );

      node = new ContainerlabNode(
        this.name,
        {...this.parts.base?.definition, ...own},
        {own, base: this.parts.base},
        this.definitions,
        this.writer,
      );
      this.withoutOwn.set(key, node);
    }

    return node.valueAt(path);
  }

  public own(path: readonly string[] = []): unknown {
    return valueAt(this.parts.own, path);
  }

  public set(path: readonly string[], value: unknown): TopologyDefinition {
    return this.writer.setNodeValue(this.name, path, value);
  }

  public reset(path: readonly string[]): TopologyDefinition {
    return this.writer.resetNodeValue(this.name, path);
  }

  private static resolveProperties(
    levels: Level[],
    kind: Resolved | null,
    group: Resolved | null,
    definition: Definition | null,
    parts: NodeParts,
  ): Map<string, NodeProperty> {
    const properties = new Map<string, NodeProperty>();
    if (kind) {
      properties.set('kind', {value: kind.value, sources: [kind.source]});
    }
    if (group) {
      properties.set('group', {value: group.value, sources: [group.source]});
    }

    for (const key of NODE_PROPERTIES) {
      if (definition?.[key] !== undefined) {
        properties.set(key, {
          value: definition[key],
          sources: [{level: 'node'}],
        });
      }
    }

    const keys = new Set(
      levels.flatMap(level => Object.keys(level.definition ?? {})),
    );
    for (const key of keys) {
      if (properties.has(key) || key === 'kind' || key === 'group') continue;

      const values: LevelValue[] = levels
        .map(level => ({source: level.source, value: level.definition?.[key]}))
        .filter(({value}) => value !== undefined && value !== null);

      const property = (PROPERTY_RULES.get(key) ?? DEFAULT_RULE).combine(
        values,
        definition === null,
      );
      if (property) properties.set(key, property);
    }

    // Values of the node that it merges come from the definition it merges
    if (parts.base) {
      const base: PropertySource = {level: 'base', name: parts.base.name};

      for (const [key, property] of properties) {
        if (parts.own && key in parts.own) continue;

        property.sources = property.sources.map(source =>
          source.level === 'node' ? base : source,
        );
      }
    }

    return properties;
  }

  /*
   * The kind of a node, from the node, from its group, from the group of the
   * defaults or from the defaults. Containerlab never reads the kind from the
   * definitions of the kinds.
   */
  private static resolveKind(
    definition: Definition | null,
    defaults: Definition,
    definitions: ContainerlabDefinitions,
  ): Resolved | null {
    const groupKind = (group: unknown): [unknown, PropertySource][] =>
      isSet(group)
        ? [
            [
              asDefinition(definitions.groups?.[String(group)])?.kind,
              {level: 'group', name: String(group)},
            ],
          ]
        : [];

    return ContainerlabNode.firstSet(
      [
        [definition?.kind, {level: 'node'}],
        ...groupKind(definition?.group),
        ...groupKind(defaults.group),
        [defaults.kind, {level: 'defaults'}],
      ],
      kind => kind.toLowerCase(),
    );
  }

  // The group of a node, a node without a definition always takes the one of the defaults
  private static resolveGroup(
    definition: Definition | null,
    kind: {name: string; definition: Definition} | null,
    defaults: Definition,
  ): Resolved | null {
    if (!definition) {
      return ContainerlabNode.firstSet([[defaults.group, {level: 'defaults'}]]);
    }

    return ContainerlabNode.firstSet([
      [definition.group, {level: 'node'}],
      ...(kind
        ? [
            [kind.definition.group, {level: 'device', name: kind.name}] as [
              unknown,
              PropertySource,
            ],
          ]
        : []),
      [defaults.group, {level: 'defaults'}],
    ]);
  }

  // The definition of a kind by its name, the exact name first and any case after that
  private static findKind(
    kind: string,
    definitions: ContainerlabDefinitions,
  ): {name: string; definition: Definition} | null {
    const kinds = definitions.kinds ?? {};
    const name =
      kind in kinds
        ? kind
        : Object.keys(kinds)
            .sort()
            .find(name => name.toLowerCase() === kind.toLowerCase());

    const definition = name ? asDefinition(kinds[name]) : null;
    return name && definition ? {name, definition} : null;
  }

  private static firstSet(
    candidates: [unknown, PropertySource][],
    format: (value: string) => string = value => value,
  ): Resolved | null {
    const found = candidates.find(([value]) => isSet(value));
    return found ? {value: format(String(found[0])), source: found[1]} : null;
  }
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (Array.isArray(current)) return current[Number(key)];
    return asDefinition(current)?.[key];
  }, value);
}
