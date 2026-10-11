export enum GraphAction {
  SelectAll,
  Deselect,
  Delete,
  Group,
  Ungroup,
  BringToFront,
  SendToBack,
  NudgeLeft,
  NudgeRight,
  NudgeUp,
  NudgeDown,
  SelectTool,
  HandTool,
}

interface GraphKeybind {
  action: GraphAction;
  key: string;
  ctrl?: boolean;

  // Matches with and without shift if undefined
  shift?: boolean;
}

const GRAPH_KEYBINDS: GraphKeybind[] = [
  {action: GraphAction.SelectAll, key: 'a', ctrl: true, shift: false},
  {action: GraphAction.Deselect, key: 'Escape'},
  {action: GraphAction.Delete, key: 'Delete'},
  {action: GraphAction.Delete, key: 'Backspace'},
  {action: GraphAction.Group, key: 'g', ctrl: true, shift: false},
  {action: GraphAction.Ungroup, key: 'g', ctrl: true, shift: true},
  {action: GraphAction.BringToFront, key: ']', ctrl: true},
  {action: GraphAction.SendToBack, key: '[', ctrl: true},
  {action: GraphAction.NudgeLeft, key: 'ArrowLeft'},
  {action: GraphAction.NudgeRight, key: 'ArrowRight'},
  {action: GraphAction.NudgeUp, key: 'ArrowUp'},
  {action: GraphAction.NudgeDown, key: 'ArrowDown'},
  {action: GraphAction.SelectTool, key: 'v', shift: false},
  {action: GraphAction.HandTool, key: 'h', shift: false},
];

/**
 * Returns the action of the pressed keys, or null if no action is bound to them.
 * Ctrl also matches the command key on macOS.
 */
export function matchGraphKeybind(event: KeyboardEvent): GraphAction | null {
  if (event.altKey) return null;

  const isCtrl = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  const keybind = GRAPH_KEYBINDS.find(
    keybind =>
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
