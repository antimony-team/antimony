import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  arrayOf,
  isBoolean,
  isDate,
  isNumber,
  isString,
  mapOf,
  nullable,
  oneOf,
  optional,
  readPersistentValue,
  recordOf,
  setOf,
  shape,
} from '@sb/lib/utils/persistent-state';

function createStorage(values: Record<string, string> = {}) {
  const items = new Map(Object.entries(values));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('primitive validators', () => {
  it('accepts strings only as strings', () => {
    expect(isString('')).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isString(null)).toBe(false);
  });

  it('accepts finite numbers only', () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(-1.5)).toBe(true);
    expect(isNumber(NaN)).toBe(false);
    expect(isNumber(Infinity)).toBe(false);
    expect(isNumber('1')).toBe(false);
  });

  it('accepts booleans only as booleans', () => {
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean('true')).toBe(false);
  });

  it('accepts valid dates only', () => {
    expect(isDate(new Date(2024, 0, 1))).toBe(true);
    expect(isDate(new Date(NaN))).toBe(false);
    expect(isDate('2024-01-01')).toBe(false);
    expect(isDate(Date.now())).toBe(false);
  });
});

describe('composed validators', () => {
  it('accepts the listed options only', () => {
    const isMode = oneOf('code', 'graph', null);
    expect(isMode('code')).toBe(true);
    expect(isMode(null)).toBe(true);
    expect(isMode('Code')).toBe(false);
    expect(isMode(undefined)).toBe(false);
  });

  it('checks every item of arrays', () => {
    expect(arrayOf(isString)([])).toBe(true);
    expect(arrayOf(isString)(['a', 'b'])).toBe(true);
    expect(arrayOf(isString)(['a', 1])).toBe(false);
    expect(arrayOf(isString)(new Set(['a']))).toBe(false);
  });

  it('checks every item of sets', () => {
    expect(setOf(isNumber)(new Set([1, 2]))).toBe(true);
    expect(setOf(isNumber)(new Set([1, 'a']))).toBe(false);
    expect(setOf(isNumber)([1, 2])).toBe(false);
  });

  it('checks the keys and values of maps', () => {
    const isMap = mapOf(isString, isNumber);
    expect(isMap(new Map([['a', 1]]))).toBe(true);
    expect(isMap(new Map([[1, 1]]))).toBe(false);
    expect(isMap(new Map([['a', 'b']]))).toBe(false);
    expect(isMap({a: 1})).toBe(false);
  });

  it('checks the values of records', () => {
    const isRecord = recordOf(isBoolean);
    expect(isRecord({})).toBe(true);
    expect(isRecord({a: true, b: false})).toBe(true);
    expect(isRecord({a: 'true'})).toBe(false);
    expect(isRecord([true])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it('checks the fields of shapes and ignores unknown fields', () => {
    const isPanel = shape({width: isNumber, title: optional(isString)});
    expect(isPanel({width: 200})).toBe(true);
    expect(isPanel({width: 200, title: 'Nodes', other: 1})).toBe(true);
    expect(isPanel({width: '200'})).toBe(false);
    expect(isPanel({title: 'Nodes'})).toBe(false);
    expect(isPanel({width: 200, title: 1})).toBe(false);
  });

  it('only accepts plain objects as shapes', () => {
    const isEmpty = shape({});
    expect(isEmpty({})).toBe(true);
    expect(isEmpty([])).toBe(false);
    expect(isEmpty(new Date())).toBe(false);
    expect(isEmpty(Object.create(null))).toBe(false);
  });

  it('accepts null for nullable values only', () => {
    expect(nullable(isString)(null)).toBe(true);
    expect(nullable(isString)(undefined)).toBe(false);
    expect(optional(isString)(undefined)).toBe(true);
    expect(optional(isString)(null)).toBe(false);
  });
});

describe('readPersistentValue', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'localStorage',
      createStorage({
        'sb:width': '320',
        'sb:broken': '{',
        'sb:map':
          '{"__type":"Map","entries":[["a",{"__type":"Set","values":[1,2]}]]}',
        'sb:date': '{"__type":"Date","time":0}',
        'sb:invalidDate': '{"__type":"Date","time":null}',
        'sb:unknownTag': '{"__type":"Other","value":1}',
      }),
    );
  });

  it('reads values under the prefix of the app', () => {
    expect(readPersistentValue('width')).toBe(320);
  });

  it('returns null for missing values', () => {
    expect(readPersistentValue('height')).toBeNull();
  });

  it('returns null for broken JSON', () => {
    expect(readPersistentValue('broken')).toBeNull();
  });

  it('returns null for values the validator rejects', () => {
    expect(readPersistentValue('width', isString)).toBeNull();
    expect(readPersistentValue('width', isNumber)).toBe(320);
  });

  it('restores nested maps and sets', () => {
    expect(
      readPersistentValue('map', mapOf(isString, setOf(isNumber))),
    ).toEqual(new Map([['a', new Set([1, 2])]]));
  });

  it('restores dates and keeps invalid dates invalid', () => {
    expect(readPersistentValue('date', isDate)).toEqual(new Date(0));
    expect(readPersistentValue('invalidDate')).toBeInstanceOf(Date);
    expect(readPersistentValue('invalidDate', isDate)).toBeNull();
  });

  it('keeps objects with unknown type tags as they are', () => {
    expect(readPersistentValue('unknownTag')).toEqual({
      __type: 'Other',
      value: 1,
    });
  });

  it('returns null if the storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(readPersistentValue('width')).toBeNull();
  });
});
