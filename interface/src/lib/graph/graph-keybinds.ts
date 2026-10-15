export enum GraphAction {
  SelectAll,
  Deselect,
  Delete,
  Group,
  Ungroup,
  BringToFront,
  BringForward,
  BringBackward,
  SendToBack,
  NudgeLeft,
  NudgeRight,
  NudgeUp,
  NudgeDown,
  SelectTool,
  HandTool,
  RectangleTool,
  EllipseTool,
  LineTool,
  TextTool,
  GroupTool,
  EditText,
  Rename,
  Copy,
  Cut,
  Paste,
  Duplicate,
}

interface GraphKeybind {
  action: GraphAction;
  key: string;
  ctrl?: boolean;

  // Matches with and without shift if undefined
  shift?: boolean;

  /*
   * Handled by the copy, cut and paste events of the browser instead, which can
   * use the clipboard without a secure context. Only listed for the labels.
   */
  isClipboardEvent?: boolean;
}

// Shift turns the brackets into braces on US layouts
const SHIFTED_KEYS = new Map([
  ['{', '['],
  ['}', ']'],
]);

const GRAPH_KEYBINDS: GraphKeybind[] = [
  {action: GraphAction.SelectAll, key: 'a', ctrl: true, shift: false},
  {action: GraphAction.Deselect, key: 'Escape'},
  {action: GraphAction.Delete, key: 'Delete'},
  {action: GraphAction.Delete, key: 'Backspace'},
  {action: GraphAction.Group, key: 'g', ctrl: true, shift: false},
  {action: GraphAction.Ungroup, key: 'g', ctrl: true, shift: true},
  {action: GraphAction.BringForward, key: ']', ctrl: true, shift: false},
  {action: GraphAction.BringToFront, key: ']', ctrl: true, shift: true},
  {action: GraphAction.BringBackward, key: '[', ctrl: true, shift: false},
  {action: GraphAction.SendToBack, key: '[', ctrl: true, shift: true},

  // The brackets need AltGr on some keyboard layouts, the arrows work on all
  {action: GraphAction.BringForward, key: 'ArrowUp', ctrl: true, shift: false},
  {action: GraphAction.BringToFront, key: 'ArrowUp', ctrl: true, shift: true},
  {
    action: GraphAction.BringBackward,
    key: 'ArrowDown',
    ctrl: true,
    shift: false,
  },
  {action: GraphAction.SendToBack, key: 'ArrowDown', ctrl: true, shift: true},
  {action: GraphAction.NudgeLeft, key: 'ArrowLeft'},
  {action: GraphAction.NudgeRight, key: 'ArrowRight'},
  {action: GraphAction.NudgeUp, key: 'ArrowUp'},
  {action: GraphAction.NudgeDown, key: 'ArrowDown'},
  {action: GraphAction.SelectTool, key: 'v', shift: false},
  {action: GraphAction.HandTool, key: 'h', shift: false},
  {action: GraphAction.RectangleTool, key: 'r', shift: false},
  {action: GraphAction.EllipseTool, key: 'o', shift: false},
  {action: GraphAction.LineTool, key: 'l', shift: false},
  {action: GraphAction.TextTool, key: 't', shift: false},
  {action: GraphAction.GroupTool, key: 'g', shift: false},
  {action: GraphAction.EditText, key: 'Enter', shift: false},
  {action: GraphAction.Rename, key: 'F2'},
  {action: GraphAction.Copy, key: 'c', ctrl: true, isClipboardEvent: true},
  {action: GraphAction.Cut, key: 'x', ctrl: true, isClipboardEvent: true},
  {action: GraphAction.Paste, key: 'v', ctrl: true, isClipboardEvent: true},
  {action: GraphAction.Duplicate, key: 'd', ctrl: true, shift: false},
];

/**
 * Returns the action of the pressed keys, or null if no action is bound to them.
 * Ctrl also matches the command key on macOS.
 */
export function matchGraphKeybind(event: KeyboardEvent): GraphAction | null {
  if (event.altKey) return null;

  const isCtrl = event.ctrlKey || event.metaKey;
  const key =
    SHIFTED_KEYS.get(event.key) ??
    (event.key.length === 1 ? event.key.toLowerCase() : event.key);

  const keybind = GRAPH_KEYBINDS.find(
    keybind =>
      !keybind.isClipboardEvent &&
      keybind.key === key &&
      !!keybind.ctrl === isCtrl &&
      (keybind.shift === undefined || keybind.shift === event.shiftKey),
  );

  return keybind?.action ?? null;
}

/**
 * Returns the first keybind of the action as it is shown in menus and tooltips,
 * e.g. "Ctrl ⇧ G".
 */
export function keybindLabel(action: GraphAction): string {
  const keybind = GRAPH_KEYBINDS.find(keybind => keybind.action === action);
  if (!keybind) return '';

  const parts = [];
  if (keybind.ctrl) parts.push('Ctrl');
  if (keybind.shift) parts.push('⇧');
  parts.push(
    keybind.key.length === 1 ? keybind.key.toUpperCase() : keybind.key,
  );

  return parts.join(' ');
}
