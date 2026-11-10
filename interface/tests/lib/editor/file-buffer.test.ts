import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  FileBuffer,
  FileChange,
  FileEditSource,
} from '@sb/lib/editor/file-buffer';
import {FileCodec} from '@sb/lib/format/file-codec';

// Reads numbers, so a text that isn't a number is invalid
const numberCodec: FileCodec<number> = {
  parse: text => (/^\d+$/.test(text) ? Number(text) : null),
  serialize: value => String(value),
  normalize: text => text.trim(),
};

describe('FileBuffer', () => {
  let buffer: FileBuffer<number>;
  let changes: FileChange[];

  beforeEach(() => {
    vi.useFakeTimers();
    buffer = new FileBuffer('1', '1', numberCodec);
    changes = [];
    buffer.onChange.register(change => changes.push(change));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads its text when it is created', () => {
    expect(buffer.value).toBe(1);
    expect(buffer.isValid).toBe(true);
    expect(buffer.isEdited).toBe(false);
  });

  it('starts at a text that differs from the saved one, e.g. a draft', () => {
    const draft = new FileBuffer('1', '2', numberCodec);

    expect(draft.value).toBe(2);
    expect(draft.isEdited).toBe(true);
  });

  it('reads typed text only after a short delay', () => {
    buffer.setText('2', FileEditSource.TextEditor);

    expect(buffer.isParsing).toBe(true);
    expect(buffer.value).toBe(1);

    vi.advanceTimersByTime(100);
    expect(buffer.isParsing).toBe(false);
    expect(buffer.value).toBe(2);
  });

  it('waits longer before it reads a large text', () => {
    buffer.setText('9'.repeat(100_001), FileEditSource.TextEditor);

    vi.advanceTimersByTime(100);
    expect(buffer.isParsing).toBe(true);

    vi.advanceTimersByTime(400);
    expect(buffer.isParsing).toBe(false);
  });

  it('reads text from anywhere else right away', () => {
    buffer.setText('3', FileEditSource.History);

    expect(buffer.isParsing).toBe(false);
    expect(buffer.value).toBe(3);
  });

  it('keeps the last valid value while the text is invalid', () => {
    buffer.setText('abc', FileEditSource.Structured);

    expect(buffer.isValid).toBe(false);
    expect(buffer.value).toBe(1);
  });

  it('reports every change of the text with its source', () => {
    buffer.setText('2', FileEditSource.TextEditor);
    buffer.setText('2', FileEditSource.TextEditor);

    expect(changes).toEqual([{text: '2', source: FileEditSource.TextEditor}]);
  });

  it('writes a value as its text', () => {
    buffer.setValue(5, FileEditSource.Structured);

    expect(buffer.text).toBe('5');
    expect(buffer.value).toBe(5);
    expect(changes).toEqual([{text: '5', source: FileEditSource.Structured}]);
  });

  it('does not report a value that gives the same text', () => {
    buffer.setValue(1, FileEditSource.Structured);

    expect(changes).toHaveLength(0);
  });

  it('takes the current text as saved', () => {
    buffer.setText('2', FileEditSource.TextEditor);
    buffer.markSaved();

    expect(buffer.isEdited).toBe(false);
  });

  it('replaces the text with a newer saved version', () => {
    buffer.setText('2', FileEditSource.TextEditor);
    buffer.reset('7');

    expect(buffer.text).toBe('7');
    expect(buffer.value).toBe(7);
    expect(buffer.isEdited).toBe(false);
    expect(changes.at(-1)?.source).toBe(FileEditSource.System);
  });

  it('normalizes text with its codec', () => {
    expect(buffer.normalize(' 1 \n')).toBe('1');
  });

  it('stops reading and reporting once it is disposed', () => {
    buffer.setText('2', FileEditSource.TextEditor);
    buffer.dispose();
    vi.runAllTimers();
    buffer.setText('3', FileEditSource.Structured);

    expect(changes).toHaveLength(1);
    expect(buffer.isParsing).toBe(false);
  });
});
