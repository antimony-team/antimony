import {describe, expect, it} from 'vitest';

import {
  GraphAction,
  keybindLabel,
  matchGraphKeybind,
} from '@sb/lib/graph/graph-keybinds';

function press(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>
  > = {},
) {
  return matchGraphKeybind({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent);
}

describe('matchGraphKeybind', () => {
  it('matches keys without modifiers', () => {
    expect(press('Escape')).toBe(GraphAction.Deselect);
    expect(press('Delete')).toBe(GraphAction.Delete);
    expect(press('Backspace')).toBe(GraphAction.Delete);
    expect(press('F2')).toBe(GraphAction.Rename);
    expect(press('r')).toBe(GraphAction.RectangleTool);
  });

  it('treats the command key like ctrl', () => {
    expect(press('a', {ctrlKey: true})).toBe(GraphAction.SelectAll);
    expect(press('a', {metaKey: true})).toBe(GraphAction.SelectAll);
    expect(press('d', {metaKey: true})).toBe(GraphAction.Duplicate);
  });

  it('tells keys with and without ctrl apart', () => {
    expect(press('g')).toBe(GraphAction.GroupTool);
    expect(press('g', {ctrlKey: true})).toBe(GraphAction.Group);
    expect(press('a')).toBeNull();
    expect(press('Escape', {ctrlKey: true})).toBeNull();
  });

  it('tells keys with and without shift apart', () => {
    expect(press('G', {ctrlKey: true, shiftKey: true})).toBe(
      GraphAction.Ungroup,
    );
    expect(press('V', {shiftKey: true})).toBeNull();
    expect(press('A', {ctrlKey: true, shiftKey: true})).toBeNull();
  });

  it('matches letters in either case', () => {
    expect(press('G', {ctrlKey: true})).toBe(GraphAction.Group);
    expect(press('T')).toBe(GraphAction.TextTool);
  });

  it('matches keys that ignore shift with and without it', () => {
    expect(press('Escape', {shiftKey: true})).toBe(GraphAction.Deselect);
    expect(press('ArrowLeft', {shiftKey: true})).toBe(GraphAction.NudgeLeft);
  });

  it('reads braces as the brackets they are shifted from', () => {
    expect(press(']', {ctrlKey: true})).toBe(GraphAction.BringForward);
    expect(press('}', {ctrlKey: true, shiftKey: true})).toBe(
      GraphAction.BringToFront,
    );
    expect(press('[', {ctrlKey: true})).toBe(GraphAction.BringBackward);
    expect(press('{', {ctrlKey: true, shiftKey: true})).toBe(
      GraphAction.SendToBack,
    );
  });

  it('orders elements with ctrl and the arrow keys', () => {
    expect(press('ArrowUp', {ctrlKey: true})).toBe(GraphAction.BringForward);
    expect(press('ArrowUp', {ctrlKey: true, shiftKey: true})).toBe(
      GraphAction.BringToFront,
    );
    expect(press('ArrowDown', {metaKey: true})).toBe(GraphAction.BringBackward);
    expect(press('ArrowDown', {ctrlKey: true, shiftKey: true})).toBe(
      GraphAction.SendToBack,
    );
    expect(press('ArrowUp')).toBe(GraphAction.NudgeUp);
  });

  it('leaves the clipboard keys to the clipboard events', () => {
    expect(press('c', {ctrlKey: true})).toBeNull();
    expect(press('x', {ctrlKey: true})).toBeNull();
    expect(press('v', {ctrlKey: true})).toBeNull();
    expect(press('v')).toBe(GraphAction.SelectTool);
  });

  it('ignores keys pressed with alt', () => {
    expect(press('Escape', {altKey: true})).toBeNull();
    expect(press(']', {ctrlKey: true, altKey: true})).toBeNull();
  });

  it('ignores keys without an action', () => {
    expect(press('q')).toBeNull();
    expect(press('Tab')).toBeNull();
  });
});

describe('keybindLabel', () => {
  it('writes ctrl, shift and the key', () => {
    expect(keybindLabel(GraphAction.Ungroup)).toBe('Ctrl ⇧ G');
    expect(keybindLabel(GraphAction.SelectAll)).toBe('Ctrl A');
    expect(keybindLabel(GraphAction.HandTool)).toBe('H');
  });

  it('keeps the names of special keys', () => {
    expect(keybindLabel(GraphAction.Deselect)).toBe('Escape');
    expect(keybindLabel(GraphAction.SendToBack)).toBe('Ctrl ⇧ [');
  });

  it('uses the first keybind of an action', () => {
    expect(keybindLabel(GraphAction.Delete)).toBe('Delete');
    expect(keybindLabel(GraphAction.BringForward)).toBe('Ctrl ]');
  });

  it('labels the clipboard keys', () => {
    expect(keybindLabel(GraphAction.Paste)).toBe('Ctrl V');
  });

  it('returns nothing for unknown actions', () => {
    expect(keybindLabel(-1 as GraphAction)).toBe('');
  });
});
