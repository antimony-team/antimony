import {
  PropertySource,
  ResolvedProperty,
} from '@sb/types/domain/topology-model';

// A node definition of containerlab, which the defaults, the kinds and the groups share
export type Definition = Record<string, unknown>;

// The value of a property on a level the node inherits from
export interface LevelValue {
  source: PropertySource;
  value: unknown;
}

/**
 * How the values of a property on the levels of a node are combined, see the
 * getters in types/topology.go of containerlab. The values are given from the
 * most specific level to the least specific one.
 */
export abstract class PropertyRule {
  /**
   * @param values The values of the levels that set the property.
   * @param isNodeEmpty Whether the node is written without a definition.
   */
  public abstract combine(
    values: LevelValue[],
    isNodeEmpty: boolean,
  ): ResolvedProperty | null;

  /*
   * Combines the values of all levels that set the property, from the defaults
   * to the node, the combined value comes from all of them.
   */
  protected joined(
    values: LevelValue[],
    combineValues: (general: unknown[]) => unknown,
  ): ResolvedProperty | null {
    const setValues = values.filter(({value}) => isSet(value));
    if (setValues.length === 0) return null;

    return {
      value: combineValues(setValues.map(({value}) => value).reverse()),
      sources: setValues.map(({source}) => source),
    };
  }
}

// The value of the most specific level that sets the property
class OverrideRule extends PropertyRule {
  public combine(values: LevelValue[]): ResolvedProperty | null {
    const value = values.find(({value}) => isSet(value));
    return value ? {value: value.value, sources: [value.source]} : null;
  }
}

// The type of a node, without the whitespace around it
class TypeRule extends OverrideRule {
  public combine(values: LevelValue[]): ResolvedProperty | null {
    const property = super.combine(values);
    if (typeof property?.value === 'string')
      property.value = property.value.trim();

    return property;
  }
}

/*
 * A boolean that counts as set even when false. A node without a definition
 * only inherits it from the defaults.
 */
class FlagRule extends PropertyRule {
  public combine(
    values: LevelValue[],
    isNodeEmpty: boolean,
  ): ResolvedProperty | null {
    const value = isNodeEmpty
      ? values.find(({source}) => source.level === 'defaults')
      : values[0];

    return value ? {value: value.value, sources: [value.source]} : null;
  }
}

// A list that is joined from the defaults to the node, without duplicates
class ListRule extends PropertyRule {
  public combine(values: LevelValue[]): ResolvedProperty | null {
    return this.joined(values, general =>
      this.combineList(unique(general.flatMap(asList))),
    );
  }

  protected combineList(list: unknown[]): unknown[] {
    return list;
  }
}

/*
 * The binds and the volumes of a node. A later one replaces the ones with the
 * same destination in the container, containerlab sorts them once merged.
 */
class BindsRule extends ListRule {
  protected combineList(list: unknown[]): unknown[] {
    const byDestination = new Map<string, unknown>();
    for (const bind of list) {
      const destination =
        typeof bind === 'string' ? (bind.split(':')[1] ?? bind) : String(bind);
      byDestination.set(destination, bind);
    }

    return [...byDestination.values()].sort((a, b) =>
      String(a).localeCompare(String(b)),
    );
  }
}

// A map whose keys are merged, the more specific level wins
class MapRule extends PropertyRule {
  public combine(values: LevelValue[]): ResolvedProperty | null {
    return this.joined(values, general =>
      Object.assign({}, ...general.map(asDefinition)),
    );
  }
}

// An object whose fields each come from the most specific level that sets them
class FieldsRule extends PropertyRule {
  public combine(values: LevelValue[]): ResolvedProperty | null {
    const fields: Definition = {};
    const sources: PropertySource[] = [];

    for (const {source, value} of values) {
      for (const [field, fieldValue] of Object.entries(
        asDefinition(value) ?? {},
      )) {
        if (field in fields || !isSet(fieldValue)) continue;

        fields[field] = fieldValue;
        if (!sources.includes(source)) sources.push(source);
      }
    }

    return sources.length > 0 ? {value: fields, sources} : null;
  }
}

/*
 * The stages of a node are merged per stage, the commands and the stages to
 * wait for of all levels are joined. A stage to wait for is only added once.
 */
class StagesRule extends PropertyRule {
  public combine(values: LevelValue[]): ResolvedProperty | null {
    return this.joined(values, general => {
      const stages: Record<
        string,
        {'wait-for': Definition[]; exec: unknown[]}
      > = {};

      for (const definition of general.map(asDefinition)) {
        for (const [name, stage] of Object.entries(definition ?? {})) {
          const merged = (stages[name] ??= {'wait-for': [], exec: []});
          const {'wait-for': waitFor, exec} = asDefinition(stage) ?? {};

          for (const item of asList(waitFor).map(asDefinition)) {
            const isAdded = merged['wait-for'].some(
              added => added.node === item?.node && added.stage === item?.stage,
            );
            if (item && !isAdded) merged['wait-for'].push(item);
          }
          merged.exec.push(...asList(exec));
        }
      }

      return stages;
    });
  }
}

/*
 * The username and the password come together from the most specific level
 * that sets either, the identity file is inherited on its own.
 */
class CredentialsRule extends PropertyRule {
  public combine(values: LevelValue[]): ResolvedProperty | null {
    const levels = values.map(({source, value}) => ({
      source,
      credentials: asDefinition(value) ?? {},
    }));

    const login = levels.find(
      ({credentials}) =>
        isSet(credentials.username) || isSet(credentials.password),
    );
    const identity = levels.find(({credentials}) =>
      isSet(credentials['identity-file']),
    );
    if (!login && !identity) return null;

    return {
      value: {
        ...(login && {
          username: login.credentials.username,
          password: login.credentials.password,
        }),
        ...(identity && {
          'identity-file': identity.credentials['identity-file'],
        }),
      },
      sources: unique([login?.source, identity?.source]).filter(
        source => source !== undefined,
      ) as PropertySource[],
    };
  }
}

// Only the variables of the configuration are merged, a node without a definition has none
class ConfigRule extends PropertyRule {
  public combine(
    values: LevelValue[],
    isNodeEmpty: boolean,
  ): ResolvedProperty | null {
    if (isNodeEmpty) return null;

    return this.joined(values, general => ({
      vars: general.reduce<Definition>(
        (vars, config) =>
          deepMerge(vars, asDefinition(asDefinition(config)?.vars) ?? {}),
        {},
      ),
    }));
  }
}

// The rule of all properties that aren't listed
export const DEFAULT_RULE: PropertyRule = new OverrideRule();

const flag = new FlagRule();
const list = new ListRule();
const binds = new BindsRule();
const map = new MapRule();

export const PROPERTY_RULES: ReadonlyMap<string, PropertyRule> = new Map([
  ['type', new TypeRule()],
  ['privileged', flag],
  ['enforce-startup-config', flag],
  ['suppress-startup-config', flag],
  ['auto-remove', flag],
  ['exec', list],
  ['env-files', list],
  ['devices', list],
  ['cap-add', list],
  ['security-opts', list],
  ['binds', binds],
  ['volumes', binds],
  ['env', map],
  ['labels', map],
  ['sysctls', map],
  ['tmpfs', map],
  ['certificate', new FieldsRule()],
  ['stages', new StagesRule()],
  ['credentials', new CredentialsRule()],
  ['config', new ConfigRule()],
]);

/**
 * Whether a value counts as set, like the zero values of Go: an empty string,
 * zero and an empty list don't override the value of a less specific level.
 */
export function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

export function asDefinition(value: unknown): Definition | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Definition)
    : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function deepMerge(target: Definition, source: Definition): Definition {
  const merged: Definition = {...target};

  for (const [key, value] of Object.entries(source)) {
    const current = asDefinition(merged[key]);
    const next = asDefinition(value);
    merged[key] = current && next ? deepMerge(current, next) : value;
  }

  return merged;
}
