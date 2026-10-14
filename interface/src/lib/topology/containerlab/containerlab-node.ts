import {
  asDefinition,
  DEFAULT_RULE,
  Definition,
  isSet,
  LevelValue,
  PROPERTY_RULES,
} from '@sb/lib/topology/containerlab/property-rules';
import {
  PropertySource,
  ResolvedNode,
  ResolvedProperty,
} from '@sb/types/domain/topology-model';

/**
 * The definitions of a containerlab topology that the nodes inherit from.
 */
export interface ContainerlabDefinitions {
  defaults?: Definition | null;
  kinds?: Record<string, Definition | null> | null;
  groups?: Record<string, Definition | null> | null;
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
export class ContainerlabNode implements ResolvedNode {
  public readonly name: string;
  public readonly device: string | undefined;
  public readonly groups: readonly string[];
  public readonly properties: ReadonlyMap<string, ResolvedProperty>;

  /**
   * @param name The name of the node.
   * @param definition The definition of the node, null if it's written without one.
   * @param definitions The definitions the node inherits from.
   */
  constructor(
    name: string,
    definition: Definition | null,
    definitions: ContainerlabDefinitions,
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
    this.device = kind?.value;
    this.groups = group ? [group.value] : [];
    this.properties = ContainerlabNode.resolveProperties(
      levels,
      kind,
      group,
      definition,
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

  private static resolveProperties(
    levels: Level[],
    kind: Resolved | null,
    group: Resolved | null,
    definition: Definition | null,
  ): Map<string, ResolvedProperty> {
    const properties = new Map<string, ResolvedProperty>();
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
