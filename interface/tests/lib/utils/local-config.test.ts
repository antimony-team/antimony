import {beforeEach, describe, expect, it, vi} from 'vitest';

import {readBool, readFloat, readInt} from '@sb/lib/utils/local-config';

beforeEach(() => {
  const items = new Map(
    Object.entries({
      on: 'true',
      off: 'false',
      other: 'yes',
      empty: '',
      int: '42',
      float: '1.5',
      text: 'abc',
    }),
  );
  vi.stubGlobal('window', {
    localStorage: {getItem: (key: string) => items.get(key) ?? null},
  });

  return () => vi.unstubAllGlobals();
});

describe('readBool', () => {
  it('reads true and false', () => {
    expect(readBool('on')).toBe(true);
    expect(readBool('off')).toBe(false);
  });

  it('returns false for other values', () => {
    expect(readBool('other')).toBe(false);
  });

  it('returns null for missing and empty values', () => {
    expect(readBool('missing')).toBeNull();
    expect(readBool('empty')).toBeNull();
  });
});

describe('readInt', () => {
  it('reads integers and cuts off decimals', () => {
    expect(readInt('int')).toBe(42);
    expect(readInt('float')).toBe(1);
  });

  it('returns null for missing and invalid values', () => {
    expect(readInt('missing')).toBeNull();
    expect(readInt('text')).toBeNull();
  });
});

describe('readFloat', () => {
  it('reads decimals', () => {
    expect(readFloat('float')).toBe(1.5);
    expect(readFloat('int')).toBe(42);
  });

  it('returns null for missing and invalid values', () => {
    expect(readFloat('empty')).toBeNull();
    expect(readFloat('text')).toBeNull();
  });
});
