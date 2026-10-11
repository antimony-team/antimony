import React, {memo} from 'react';

import classNames from 'classnames';

import {Button} from 'primereact/button';
import {SelectButton} from 'primereact/selectbutton';
import {Tooltip} from 'primereact/tooltip';

import {Box, GraphGroup} from '@sb/lib/graph/annotation-geometry';
import {GraphAction, keybindLabel} from '@sb/lib/graph/graph-keybinds';
import {BorderStyle} from '@sb/types/domain/topology';

import './selection-bar.sass';

const BORDER_STYLES: BorderStyle[] = ['solid', 'dashed', 'dotted'];

// Distance between the selection and the bar below it
const BAR_GAP = 14;

interface SelectionBarProps {
  // The selection in coordinates of the graph's container, the bar is hidden if null
  box: Box | null;

  // Set if the selection is exactly one group
  group: GraphGroup | null;

  canGroup: boolean;
  canReorder: boolean;

  onGroup: () => void;
  onBorderStyle: (borderStyle: BorderStyle) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}

/**
 * The bar below the selected elements of the graph. It changes how the selected
 * elements look, the context menu holds the remaining commands.
 *
 * Mounting and rendering the bar takes a while, so it stays mounted, its parts
 * are only hidden, and it only renders again when its props change. The buttons
 * share one tooltip for the same reason.
 */
const SelectionBar = memo((props: SelectionBarProps) => {
  return (
    <div
      className={classNames('sb-selection-bar', {hidden: !props.box})}
      style={
        props.box
          ? {
              left: props.box.x + props.box.width / 2,
              top: props.box.y + props.box.height + BAR_GAP,
            }
          : undefined
      }
    >
      <Tooltip target=".sb-selection-bar [data-pr-tooltip]" position="bottom" />
      <span
        className={classNames('sb-selection-bar-part', {hidden: !props.group})}
      >
        <SelectButton
          value={props.group?.annotation?.borderStyle ?? 'solid'}
          options={BORDER_STYLES}
          allowEmpty={false}
          onChange={e => props.onBorderStyle(e.value)}
          itemTemplate={(borderStyle: BorderStyle) => (
            <span
              className="sb-selection-bar-line"
              style={{borderTopStyle: borderStyle}}
              aria-label={`${borderStyle} border`}
            />
          )}
        />
        <span className="sb-selection-bar-separator" />
      </span>
      <span
        className={classNames('sb-selection-bar-part', {
          hidden: props.group || !props.canGroup,
        })}
      >
        <Button
          text
          icon={<span className="material-symbols-outlined">select</span>}
          label="Group"
          onClick={props.onGroup}
          data-pr-tooltip={keybindLabel(GraphAction.Group)}
        />
        <span className="sb-selection-bar-separator" />
      </span>
      <span
        className={classNames('sb-selection-bar-part', {
          hidden: !props.canReorder,
        })}
      >
        <Button
          text
          icon={
            <span className="material-symbols-outlined">flip_to_front</span>
          }
          onClick={props.onBringToFront}
          data-pr-tooltip={`Bring to front (${keybindLabel(GraphAction.BringToFront)})`}
          aria-label="Bring to front"
        />
        <Button
          text
          icon={<span className="material-symbols-outlined">flip_to_back</span>}
          onClick={props.onSendToBack}
          data-pr-tooltip={`Send to back (${keybindLabel(GraphAction.SendToBack)})`}
          aria-label="Send to back"
        />
        <span className="sb-selection-bar-separator" />
      </span>
      <span
        className={classNames('sb-selection-bar-part', {hidden: !props.group})}
      >
        <Button
          text
          icon={<span className="material-symbols-outlined">ungroup</span>}
          onClick={props.onUngroup}
          data-pr-tooltip={`Ungroup (${keybindLabel(GraphAction.Ungroup)})`}
          aria-label="Ungroup"
        />
      </span>
      <Button
        text
        icon="pi pi-trash"
        className="sb-selection-bar-delete"
        onClick={props.onDelete}
        data-pr-tooltip={props.group ? 'Delete group and nodes' : 'Delete'}
        aria-label="Delete"
      />
    </div>
  );
});

export default SelectionBar;
