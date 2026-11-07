import {describe, expect, it} from 'vitest';

import {ToggleSet} from '@sb/lib/utils/toggle-set';

describe('ToggleSet', () => {
  it('adds missing values and removes present ones', () => {
    const set = new ToggleSet<string>(['a']);
    set.toggle('a').toggle('b');
    expect([...set]).toEqual(['b']);
  });

  it('adds or removes values explicitly', () => {
    const set = new ToggleSet<string>();
    set.toggleExplicit('a', true).toggleExplicit('a', true);
    expect([...set]).toEqual(['a']);

    set.toggleExplicit('a', false).toggleExplicit('b', false);
    expect(set.size).toBe(0);
  });
});
