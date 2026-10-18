import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  GraphSelectionSnapshot,
  TopologyHistory,
  TopologyHistoryEntry,
} from '@sb/lib/topology-history';
import {TopologyFileType} from '@sb/types/domain/topology';

function entry(
  definition: string,
  overrides: Partial<TopologyHistoryEntry> = {},
): TopologyHistoryEntry {
  return {
    definition,
    annotations: '{}',
    file: TopologyFileType.Definition,
    selections: null,
    ...overrides,
  };
}

function selection(...nodeIds: string[]): GraphSelectionSnapshot {
  return {nodeIds, groupIds: [], shapeIds: [], textIds: []};
}

describe('TopologyHistory', () => {
  let history: TopologyHistory;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    history = new TopologyHistory();
    history.reset(entry('a'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has nothing to undo or redo after a reset', () => {
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    expect(history.length).toBe(1);
  });

  it('undoes and redoes recorded changes in order', () => {
    history.record(entry('b'), null);
    history.record(entry('c'), null);

    expect(history.undo()?.entry.definition).toBe('b');
    expect(history.undo()?.entry.definition).toBe('a');
    expect(history.canUndo).toBe(false);
    expect(history.redo()?.entry.definition).toBe('b');
    expect(history.redo()?.entry.definition).toBe('c');
    expect(history.canRedo).toBe(false);
  });

  it('reports the file of the undone change instead of the restored one', () => {
    history.record(entry('b', {file: TopologyFileType.Annotations}), null);

    const undone = history.undo();
    expect(undone?.entry.file).toBe(TopologyFileType.Definition);
    expect(undone?.file).toBe(TopologyFileType.Annotations);
  });

  it('drops the changes that could be redone when a new change is recorded', () => {
    history.record(entry('b'), null);
    history.record(entry('c'), null);
    history.undo();
    history.record(entry('d'), null);

    expect(history.canRedo).toBe(false);
    expect(history.length).toBe(3);
    expect(history.undo()?.entry.definition).toBe('b');
  });

  it('merges changes with the same key within a second', () => {
    history.record(entry('b'), 'typing');
    vi.setSystemTime(500);
    history.record(entry('bc'), 'typing');

    expect(history.length).toBe(2);
    expect(history.undo()?.entry.definition).toBe('a');
    expect(history.redo()?.entry.definition).toBe('bc');
  });

  it('keeps changes with the same key apart after a second', () => {
    history.record(entry('b'), 'typing');
    vi.setSystemTime(1000);
    history.record(entry('bc'), 'typing');

    expect(history.length).toBe(3);
  });

  it('keeps changes with different keys apart', () => {
    history.record(entry('b'), 'typing');
    history.record(entry('c'), 'nudging');

    expect(history.length).toBe(3);
  });

  it('never merges changes without a key', () => {
    history.record(entry('b'), null);
    history.record(entry('c'), null);

    expect(history.length).toBe(3);
  });

  it('does not merge a change into one before an undo', () => {
    history.record(entry('b'), 'typing');
    history.undo();
    history.redo();
    history.record(entry('c'), 'typing');

    expect(history.length).toBe(3);
  });

  it('keeps the selection before the first of the merged changes', () => {
    history.record(
      entry('b', {graphSelectionBefore: selection('n1')}),
      'nudge',
    );
    history.record(
      entry('c', {graphSelectionBefore: selection('n2')}),
      'nudge',
    );

    expect(history.undo(selection('n2'))?.graphSelection).toEqual(
      selection('n1'),
    );
  });

  it('restores the selection after a graph change when it is redone', () => {
    history.record(entry('b', {graphSelectionBefore: selection('n1')}), null);

    const undone = history.undo(selection('n1', 'n2'));
    expect(undone?.graphSelection).toEqual(selection('n1'));

    expect(history.redo()?.graphSelection).toEqual(selection('n1', 'n2'));
  });

  it('has no selection to restore after a change of the text', () => {
    history.record(entry('b'), null);

    expect(history.undo(selection('n1'))?.graphSelection).toBeUndefined();
    expect(history.redo()?.graphSelection).toBeUndefined();
  });

  it('keeps at most 100 entries and drops the oldest ones', () => {
    for (let i = 1; i <= 150; i++) history.record(entry(`v${i}`), null);

    expect(history.length).toBe(100);
    expect(history.position).toBe(99);

    let oldest = null;
    while (history.canUndo) oldest = history.undo();
    expect(oldest?.entry.definition).toBe('v51');
  });

  it('starts over after another reset', () => {
    history.record(entry('b'), 'typing');
    history.reset(entry('x'));
    history.record(entry('y'), 'typing');

    expect(history.length).toBe(2);
    expect(history.undo()?.entry.definition).toBe('x');
  });
});
