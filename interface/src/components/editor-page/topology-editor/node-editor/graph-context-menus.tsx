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

interface NodeMenuOptions {
  groups: {id: string; name: string}[];

  onEdit: () => void;
  onConnect: () => void;
  onAddToGroup: (groupId: string) => void;
  onDelete: () => void;
}

export function nodeMenu(options: NodeMenuOptions): MenuItem[] {
  return [
    {label: 'Edit node…', icon: icon('edit_square'), command: options.onEdit},
    {
      label: 'Connect',
      icon: 'pi pi-arrow-right-arrow-left',
      command: options.onConnect,
    },
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

export function linkMenu(onDelete: () => void): MenuItem[] {
  return [
    withKeybind(
      {
        label: 'Delete link',
        icon: 'pi pi-trash',
        className: 'sb-menuitem-danger',
        command: onDelete,
      },
      GraphAction.Delete,
    ),
  ];
}

interface SelectionMenuOptions {
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

interface GroupMenuOptions {
  onRename: () => void;
  onSelectMembers: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}

export function groupMenu(options: GroupMenuOptions): MenuItem[] {
  return [
    {label: 'Rename…', icon: icon('edit'), command: options.onRename},
    {
      label: 'Select members',
      icon: icon('select_all'),
      command: options.onSelectMembers,
    },
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

interface ShapeMenuOptions {
  shapeType: FreeShapeAnnotation['shapeType'];

  // Changes a rectangle to an ellipse and back, or reverses a line
  onChangeShape: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
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

interface GraphMenuOptions {
  onAddNode: () => void;
  onSelectAll: () => void;
  onFit: () => void;
  onClear: () => void;
}

export function graphMenu(options: GraphMenuOptions): MenuItem[] {
  return [
    {label: 'Add node here', icon: 'pi pi-plus', command: options.onAddNode},
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
