import React, {cloneElement, ReactElement, ReactNode} from 'react';

import {MenuItem} from 'primereact/menuitem';

import {GraphAction, keybindLabel} from '@sb/lib/graph/graph-keybinds';
import {FreeShapeAnnotation} from '@sb/types/domain/topology';

const SEPARATOR: MenuItem = {separator: true};

/**
 * Shows the keybind of the action at the end of the menu item.
 */
function withKeybind(item: MenuItem, action: GraphAction): MenuItem {
  return {
    ...item,
    template: (_, options) => {
      const element = options.element as ReactElement<{children?: ReactNode}>;

      return cloneElement(
        element,
        undefined,
        ...React.Children.toArray(element.props.children),
        <span key="keybind" className="sb-menuitem-keybind">
          {keybindLabel(action)}
        </span>,
      );
    },
  };
}

function icon(name: string) {
  return <span className="material-symbols-outlined">{name}</span>;
}

interface ClipboardOptions {
  onCopy: () => void;
  onCut: () => void;
  onDuplicate: () => void;
}

// Copy, cut and duplicate, after the first items of a menu
function clipboardItems(options: ClipboardOptions): MenuItem[] {
  return [
    SEPARATOR,
    withKeybind(
      {label: 'Copy', icon: icon('content_copy'), command: options.onCopy},
      GraphAction.Copy,
    ),
    withKeybind(
      {label: 'Cut', icon: icon('content_cut'), command: options.onCut},
      GraphAction.Cut,
    ),
    withKeybind(
      {
        label: 'Duplicate',
        icon: icon('library_add'),
        command: options.onDuplicate,
      },
      GraphAction.Duplicate,
    ),
  ];
}

interface NodeMenuOptions extends ClipboardOptions {
  groups: {id: string; name: string}[];

  onRename: () => void;
  onEdit: () => void;
  onConnect: () => void;
  onAddToGroup: (groupId: string) => void;
  onDelete: () => void;
}

export function nodeMenu(options: NodeMenuOptions): MenuItem[] {
  return [
    withKeybind(
      {label: 'Rename…', icon: icon('edit'), command: options.onRename},
      GraphAction.Rename,
    ),
    {label: 'Edit node…', icon: icon('edit_square'), command: options.onEdit},
    {
      label: 'Connect',
      icon: 'pi pi-arrow-right-arrow-left',
      command: options.onConnect,
    },
    ...clipboardItems(options),
    SEPARATOR,
    {
      label: 'Add to group',
      icon: icon('select'),
      disabled: options.groups.length === 0,
      items: options.groups.map(group => ({
        label: group.name,
        command: () => options.onAddToGroup(group.id),
      })),
    },
    SEPARATOR,
    withKeybind(
      {
        label: 'Delete',
        icon: 'pi pi-trash',
        className: 'sb-menuitem-danger',
        command: options.onDelete,
      },
      GraphAction.Delete,
    ),
  ];
}

interface LinkMenuOptions {
  // The endpoints of the link, e.g. srl1:e1-1
  endpoints: [string, string];

  onRenameInterface: (endpointIndex: number) => void;
  onDelete: () => void;
}

export function linkMenu(options: LinkMenuOptions): MenuItem[] {
  return [
    ...options.endpoints.map((endpoint, index) => ({
      label: `Rename ${endpoint}`,
      icon: icon('edit'),
      command: () => options.onRenameInterface(index),
    })),
    SEPARATOR,
    withKeybind(
      {
        label: 'Delete link',
        icon: 'pi pi-trash',
        className: 'sb-menuitem-danger',
        command: options.onDelete,
      },
      GraphAction.Delete,
    ),
  ];
}

interface SelectionMenuOptions extends ClipboardOptions {
  count: number;
  canGroup: boolean;
  canReorder: boolean;

  onGroup: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}

export function selectionMenu(options: SelectionMenuOptions): MenuItem[] {
  return [
    withKeybind(
      {
        label: 'Group',
        icon: icon('select'),
        disabled: !options.canGroup,
        command: options.onGroup,
      },
      GraphAction.Group,
    ),
    ...clipboardItems(options),
    ...(options.canReorder
      ? [
          SEPARATOR,
          withKeybind(
            {
              label: 'Bring to front',
              icon: icon('flip_to_front'),
              command: options.onBringToFront,
            },
            GraphAction.BringToFront,
          ),
          withKeybind(
            {
              label: 'Send to back',
              icon: icon('flip_to_back'),
              command: options.onSendToBack,
            },
            GraphAction.SendToBack,
          ),
        ]
      : []),
    SEPARATOR,
    withKeybind(
      {
        label: `Delete ${options.count} items`,
        icon: 'pi pi-trash',
        className: 'sb-menuitem-danger',
        command: options.onDelete,
      },
      GraphAction.Delete,
    ),
  ];
}

interface GroupMenuOptions extends ClipboardOptions {
  onRename: () => void;
  onSelectMembers: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}

export function groupMenu(options: GroupMenuOptions): MenuItem[] {
  return [
    withKeybind(
      {label: 'Rename…', icon: icon('edit'), command: options.onRename},
      GraphAction.Rename,
    ),
    {
      label: 'Select members',
      icon: icon('select_all'),
      command: options.onSelectMembers,
    },
    ...clipboardItems(options),
    SEPARATOR,
    withKeybind(
      {
        label: 'Bring to front',
        icon: icon('flip_to_front'),
        command: options.onBringToFront,
      },
      GraphAction.BringToFront,
    ),
    withKeybind(
      {
        label: 'Send to back',
        icon: icon('flip_to_back'),
        command: options.onSendToBack,
      },
      GraphAction.SendToBack,
    ),
    SEPARATOR,
    withKeybind(
      {label: 'Ungroup', icon: icon('ungroup'), command: options.onUngroup},
      GraphAction.Ungroup,
    ),
    {
      label: 'Delete group and nodes',
      icon: 'pi pi-trash',
      className: 'sb-menuitem-danger',
      command: options.onDelete,
    },
  ];
}

interface ShapeMenuOptions extends OrderAndDeleteOptions {
  shapeType: FreeShapeAnnotation['shapeType'];

  // Changes a rectangle to an ellipse and back, or reverses a line
  onChangeShape: () => void;
}

export function shapeMenu(options: ShapeMenuOptions): MenuItem[] {
  const changeItem: MenuItem =
    options.shapeType === 'line'
      ? {label: 'Reverse direction', icon: icon('swap_horiz')}
      : options.shapeType === 'rectangle'
        ? {label: 'Change to ellipse', icon: icon('circle')}
        : {label: 'Change to rectangle', icon: icon('rectangle')};

  return [
    {...changeItem, command: options.onChangeShape},
    ...clipboardItems(options),
    ...orderAndDeleteItems(options),
  ];
}

interface OrderAndDeleteOptions extends ClipboardOptions {
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}

// The items at the end of the menus of shapes and texts
function orderAndDeleteItems(options: OrderAndDeleteOptions): MenuItem[] {
  return [
    SEPARATOR,
    withKeybind(
      {
        label: 'Bring to front',
        icon: icon('flip_to_front'),
        command: options.onBringToFront,
      },
      GraphAction.BringToFront,
    ),
    withKeybind(
      {
        label: 'Send to back',
        icon: icon('flip_to_back'),
        command: options.onSendToBack,
      },
      GraphAction.SendToBack,
    ),
    SEPARATOR,
    withKeybind(
      {
        label: 'Delete',
        icon: 'pi pi-trash',
        className: 'sb-menuitem-danger',
        command: options.onDelete,
      },
      GraphAction.Delete,
    ),
  ];
}

interface TextMenuOptions extends OrderAndDeleteOptions {
  onEdit: () => void;
}

export function textMenu(options: TextMenuOptions): MenuItem[] {
  return [
    withKeybind(
      {label: 'Edit text', icon: icon('edit'), command: options.onEdit},
      GraphAction.EditText,
    ),
    ...clipboardItems(options),
    ...orderAndDeleteItems(options),
  ];
}

interface GraphMenuOptions {
  canPaste: boolean;

  onAddNode: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onFit: () => void;
  onClear: () => void;
}

export function graphMenu(options: GraphMenuOptions): MenuItem[] {
  return [
    {label: 'Add node here', icon: 'pi pi-plus', command: options.onAddNode},
    withKeybind(
      {
        label: 'Paste',
        icon: icon('content_paste'),
        disabled: !options.canPaste,
        command: options.onPaste,
      },
      GraphAction.Paste,
    ),
    SEPARATOR,
    withKeybind(
      {
        label: 'Select all',
        icon: icon('select_all'),
        command: options.onSelectAll,
      },
      GraphAction.SelectAll,
    ),
    {label: 'Fit graph', icon: icon('fit_screen'), command: options.onFit},
    SEPARATOR,
    {
      label: 'Clear graph',
      icon: 'pi pi-trash',
      className: 'sb-menuitem-danger',
      command: options.onClear,
    },
  ];
}
