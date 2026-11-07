import {useEffect, useState} from 'react';

const STORAGE_PREFIX = 'sb:'; // keep your existing prefix

// Marker key for values JSON can't represent natively.
// Unlikely to collide with real data; change it if it ever does.
const TYPE_TAG = '__type';

type Tagged =
  | {[TYPE_TAG]: 'Map'; entries: [unknown, unknown][]}
  | {[TYPE_TAG]: 'Set'; values: unknown[]}
  | {[TYPE_TAG]: 'Date'; time: number | null};

function isTagged(value: unknown): value is Tagged {
  return typeof value === 'object' && value !== null && TYPE_TAG in value;
}

// `this[key]` is the raw value *before* toJSON runs, so Dates are still Dates here.
// Nested Maps/Sets work because stringify recurses into whatever we return.
function replacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = this[key];
  if (raw instanceof Map)
    return {[TYPE_TAG]: 'Map', entries: [...raw.entries()]};
  if (raw instanceof Set) return {[TYPE_TAG]: 'Set', values: [...raw]};
  if (raw instanceof Date) {
    const time = raw.getTime();
    return {[TYPE_TAG]: 'Date', time: Number.isNaN(time) ? null : time};
  }
  return value;
}

// The reviver runs bottom-up, so nested values are already restored by the
// time their parent Map/Set is rebuilt.
function reviver(_key: string, value: unknown) {
  if (!isTagged(value)) return value;
  switch (value[TYPE_TAG]) {
    case 'Map':
      return new Map(value.entries);
    case 'Set':
      return new Set(value.values);
    case 'Date':
      return new Date(value.time ?? NaN);
    default:
      return value;
  }
}

const serialize = (value: unknown) => JSON.stringify(value, replacer);
const deserialize = (text: string): unknown => JSON.parse(text, reviver);

export function readPersistentValue<T>(
  key: string,
  isValid?: (value: unknown) => value is T,
): T | null {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    if (stored === null) return null;

    const parsed = deserialize(stored);
    if (isValid && !isValid(parsed)) return null;

    return parsed as T;
  } catch {
    return null;
  }
}

export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  isValid?: (value: unknown) => value is T,
) {
  const storageKey = STORAGE_PREFIX + key;

  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === null) return defaultValue;

      const parsed = deserialize(stored);
      if (isValid && !isValid(parsed)) return defaultValue;

      return parsed as T;
    } catch {
      // Broken JSON or storage blocked (private mode): fall back to the default
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, serialize(value));
    } catch {
      // Storage full or blocked: the value still works for this session
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}

export type Guard<T> = (value: unknown) => value is T;
export type Infer<G> = G extends Guard<infer T> ? T : never;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/*
 * Primitives
 */
export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

export function isDate(v: unknown): v is Date {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

/*
 * Literal unions: oneOf('Active', 'Inactive') -> Guard<'Active' | 'Inactive'>
 */
export function oneOf<
  const T extends readonly (string | number | boolean | null)[],
>(...options: T): Guard<T[number]> {
  return function isOneOf(v: unknown): v is T[number] {
    return options.includes(v as T[number]);
  };
}

/*
 * Collections
 */
export function arrayOf<T>(item: Guard<T>): Guard<T[]> {
  return function isArrayOf(v: unknown): v is T[] {
    return Array.isArray(v) && v.every(x => item(x));
  };
}

export function setOf<T>(item: Guard<T>): Guard<Set<T>> {
  return function isSetOf(v: unknown): v is Set<T> {
    return v instanceof Set && [...v].every(x => item(x));
  };
}

export function mapOf<K, V>(key: Guard<K>, value: Guard<V>): Guard<Map<K, V>> {
  return function isMapOf(v: unknown): v is Map<K, V> {
    return v instanceof Map && [...v].every(([k, x]) => key(k) && value(x));
  };
}

export function recordOf<V>(value: Guard<V>): Guard<Record<string, V>> {
  return function isRecordOf(v: unknown): v is Record<string, V> {
    return isPlainObject(v) && Object.values(v).every(x => value(x));
  };
}

/*
 * Objects with known fields: shape({ name: isString, age: optional(isNumber) })
 */
export function shape<S extends Record<string, Guard<unknown>>>(
  schema: S,
): Guard<{[K in keyof S]: Infer<S[K]>}> {
  return function isShape(v: unknown): v is {[K in keyof S]: Infer<S[K]>} {
    return (
      isPlainObject(v) &&
      Object.entries(schema).every(([k, guard]) => guard(v[k]))
    );
  };
}

/*
 * Modifiers
 */
export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return function isOptional(v: unknown): v is T | undefined {
    return v === undefined || guard(v);
  };
}

export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return function isNullable(v: unknown): v is T | null {
    return v === null || guard(v);
  };
}
