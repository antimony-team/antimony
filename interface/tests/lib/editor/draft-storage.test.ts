import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DraftStorage, hashTexts} from '@sb/lib/editor/draft-storage';

import {MemoryStorage} from './fakes';

const draft = {baseHash: 'hash', texts: {definition: 'name: lab\n'}};

describe('DraftStorage', () => {
  let drafts: DraftStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', new MemoryStorage());
    drafts = new DraftStorage('user-id');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('writes a draft shortly after the last change', () => {
    drafts.saveDebounced('doc', () => draft);
    expect(drafts.load('doc')).toBeNull();

    vi.advanceTimersByTime(500);
    expect(drafts.load('doc')).toEqual(draft);
  });

  it('writes only the last of quick changes', () => {
    const write = vi.fn(() => draft);
    drafts.saveDebounced('doc', write);
    drafts.saveDebounced('doc', write);
    vi.runAllTimers();

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('writes waiting drafts right away when flushed', () => {
    drafts.saveDebounced('doc', () => draft);
    drafts.flush();

    expect(drafts.load('doc')).toEqual(draft);
  });

  it('deletes a draft, also one that is still waiting', () => {
    drafts.saveDebounced('doc', () => draft);
    drafts.flush();
    drafts.saveDebounced('doc', () => draft);
    drafts.delete('doc');
    vi.runAllTimers();

    expect(drafts.load('doc')).toBeNull();
  });

  it('keeps the drafts of each user apart', () => {
    drafts.saveDebounced('doc', () => draft);
    drafts.flush();

    expect(new DraftStorage('other-user').load('doc')).toBeNull();
    expect(new DraftStorage('other-user').documentIds()).toEqual([]);
    expect(drafts.documentIds()).toEqual(['doc']);
  });

  it('ignores a stored draft it can not read', () => {
    localStorage.setItem('sb:editor-draft:user-id:doc', '{broken');

    expect(drafts.load('doc')).toBeNull();
  });
});

describe('hashTexts', () => {
  it('gives the same hash for the same texts', () => {
    expect(hashTexts(['a', 'b'])).toBe(hashTexts(['a', 'b']));
  });

  it('gives different hashes for different texts', () => {
    expect(hashTexts(['a', 'b'])).not.toBe(hashTexts(['a', 'c']));
  });

  it('tells apart texts that only differ in where they are split', () => {
    expect(hashTexts(['ab', ''])).not.toBe(hashTexts(['a', 'b']));
  });
});
