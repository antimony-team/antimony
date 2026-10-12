import React, {memo, useEffect, useRef, useState} from 'react';

import classNames from 'classnames';

import {Button} from 'primereact/button';
import {SelectButton} from 'primereact/selectbutton';
import {Tooltip} from 'primereact/tooltip';

import SBScrubNumber from '@sb/components/common/sb-scrub-number/sb-scrub-number';
import ColorPopover from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/color-popover';
import {SelectionPopoverRef} from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-popover';
import SliderPopover from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/slider-popover';
import WidthPopover from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/width-popover';
import {
  Box,
  LayerItem,
  shapeBox,
  shapeGeometry,
} from '@sb/lib/graph/annotation-geometry';
import {
  AnnotationStyle,
  defaultStyle,
  groupStyle,
  NO_COLOR,
  shapeStyle,
} from '@sb/lib/graph/annotation-style';
import {GraphAction, keybindLabel} from '@sb/lib/graph/graph-keybinds';
import {BorderStyle} from '@sb/types/domain/topology';

import './selection-bar.sass';

const BORDER_STYLES: BorderStyle[] = ['solid', 'dashed', 'dotted'];

// Distance between the selection and the bar below it
const BAR_GAP = 14;

enum BarPopover {
  Fill,
  Border,
  Width,
  Radius,
}

interface SelectionBarProps {
  // The selection in coordinates of the graph's container, the bar is hidden if null
  box: Box | null;

  // Set if the selection is exactly one group or shape
  item: LayerItem | null;

  canGroup: boolean;
  canReorder: boolean;

  onGroup: () => void;
  onStyle: (style: Partial<AnnotationStyle>) => void;
  onStylePreview: (style: Partial<AnnotationStyle> | null) => void;
  onResetStyle: (fields: (keyof AnnotationStyle)[]) => void;
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
  const [openPopover, setOpenPopover] = useState<BarPopover | null>(null);

  const popoverRefs = {
    [BarPopover.Fill]: useRef<SelectionPopoverRef>(null),
    [BarPopover.Border]: useRef<SelectionPopoverRef>(null),
    [BarPopover.Width]: useRef<SelectionPopoverRef>(null),
    [BarPopover.Radius]: useRef<SelectionPopoverRef>(null),
  };

  const item = props.item;
  const isLine =
    item?.kind === 'shape' && item.shape.annotation.shapeType === 'line';
  const isGroup = item?.kind === 'group';
  const hasFill = !!item && !isLine;
  const hasRadius =
    isGroup ||
    (item?.kind === 'shape' && item.shape.annotation.shapeType === 'rectangle');

  const style = item
    ? item.kind === 'group'
      ? groupStyle(item.group.annotation)
      : shapeStyle(item.shape.annotation)
    : null;
  const hasBorder = !!style && style.borderColor !== NO_COLOR;

  // At half of the shorter side, the corners are fully rounded
  const itemBox = item
    ? item.kind === 'group'
      ? item.group
      : shapeBox(shapeGeometry(item.shape.annotation))
    : null;
  const maxRadius = itemBox
    ? Math.floor(Math.min(itemBox.width, itemBox.height) / 2)
    : 0;
  const cornerRadius = Math.min(maxRadius, style?.cornerRadius ?? 0);

  const defaults = item
    ? defaultStyle(
        item.kind === 'shape' ? item.shape.annotation.shapeType : undefined,
      )
    : null;
  const isModified = (field: keyof AnnotationStyle) =>
    !!style && !!defaults && style[field] !== defaults[field];

  // An open popover belongs to the selection it was opened for
  useEffect(() => {
    if (openPopover !== null) popoverRefs[openPopover].current?.hide();
  }, [item?.id, !!props.box]);

  function togglePopover(popover: BarPopover, target: HTMLElement) {
    setOpenPopover(popover);
    popoverRefs[popover].current?.toggle(target);
  }

  function onPopoverHide() {
    setOpenPopover(null);
    props.onStylePreview(null);
  }

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
      <span className={classNames('sb-selection-bar-part', {hidden: !hasFill})}>
        <button
          className={classNames('sb-selection-bar-swatch', {
            active: openPopover === BarPopover.Fill,
          })}
          onClick={event => togglePopover(BarPopover.Fill, event.currentTarget)}
          data-pr-tooltip="Fill"
          aria-label="Fill"
        >
          <span
            className={classNames('sb-color-swatch', {
              none: style?.fillColor === NO_COLOR,
            })}
            style={{backgroundColor: swatchColor(style?.fillColor)}}
          />
          <i className="pi pi-chevron-down" />
        </button>
        <span className="sb-selection-bar-separator" />
      </span>
      <span className={classNames('sb-selection-bar-part', {hidden: !item})}>
        <button
          className={classNames('sb-selection-bar-swatch', {
            active: openPopover === BarPopover.Border,
          })}
          onClick={event =>
            togglePopover(BarPopover.Border, event.currentTarget)
          }
          data-pr-tooltip={isLine ? 'Line color' : 'Border color'}
          aria-label={isLine ? 'Line color' : 'Border color'}
        >
          <span
            className={classNames('sb-color-swatch', {
              none: !hasBorder,
              ring: !isLine,
            })}
            style={
              isLine
                ? {backgroundColor: swatchColor(style?.borderColor)}
                : {borderColor: swatchColor(style?.borderColor)}
            }
          />
          <i className="pi pi-chevron-down" />
        </button>
        <SelectButton
          value={style?.borderStyle ?? 'solid'}
          options={BORDER_STYLES}
          allowEmpty={false}
          disabled={!hasBorder}
          onChange={e => props.onStyle({borderStyle: e.value})}
          itemTemplate={(borderStyle: BorderStyle) => (
            <span
              className="sb-selection-bar-line"
              style={{borderTopStyle: borderStyle}}
              aria-label={`${borderStyle} ${isLine ? 'line' : 'border'}`}
            />
          )}
        />
        <SBScrubNumber
          value={style?.borderWidth ?? 1}
          min={0.5}
          max={20}
          step={0.5}
          isActive={openPopover === BarPopover.Width}
          disabled={!hasBorder}
          ariaLabel={isLine ? 'Line width' : 'Border width'}
          onChange={borderWidth => props.onStylePreview({borderWidth})}
          onChangeEnd={borderWidth => props.onStyle({borderWidth})}
          onReset={() => props.onResetStyle(['borderWidth'])}
          onClick={target => togglePopover(BarPopover.Width, target)}
        />
      </span>
      <span
        className={classNames('sb-selection-bar-part', {hidden: !hasRadius})}
      >
        <span className="sb-selection-bar-separator" />
        <SBScrubNumber
          value={cornerRadius}
          min={0}
          max={maxRadius}
          icon={
            <span className="material-symbols-outlined">rounded_corner</span>
          }
          isActive={openPopover === BarPopover.Radius}
          ariaLabel="Corner radius"
          onChange={cornerRadius => props.onStylePreview({cornerRadius})}
          onChangeEnd={cornerRadius => props.onStyle({cornerRadius})}
          onReset={() => props.onResetStyle(['cornerRadius'])}
          onClick={target => togglePopover(BarPopover.Radius, target)}
        />
      </span>
      <span className={classNames('sb-selection-bar-part', {hidden: !isLine})}>
        <span className="sb-selection-bar-separator" />
        <Button
          text
          icon={<span className="material-symbols-outlined">arrow_back</span>}
          className={classNames({toggled: style?.lineStartArrow})}
          onClick={() =>
            props.onStyle({lineStartArrow: !style?.lineStartArrow})
          }
          data-pr-tooltip="Arrow at the start"
          aria-label="Arrow at the start"
          aria-pressed={!!style?.lineStartArrow}
        />
        <Button
          text
          icon={
            <span className="material-symbols-outlined">arrow_forward</span>
          }
          className={classNames({toggled: style?.lineEndArrow})}
          onClick={() => props.onStyle({lineEndArrow: !style?.lineEndArrow})}
          data-pr-tooltip="Arrow at the end"
          aria-label="Arrow at the end"
          aria-pressed={!!style?.lineEndArrow}
        />
      </span>
      <span className={classNames('sb-selection-bar-part', {hidden: !item})}>
        <span className="sb-selection-bar-separator" />
      </span>
      <span
        className={classNames('sb-selection-bar-part', {
          hidden: item || !props.canGroup,
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
      <span className={classNames('sb-selection-bar-part', {hidden: !isGroup})}>
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
        data-pr-tooltip={isGroup ? 'Delete group and nodes' : 'Delete'}
        aria-label="Delete"
      />
      <ColorPopover
        ref={popoverRefs[BarPopover.Fill]}
        header="Fill"
        color={style?.fillColor ?? NO_COLOR}
        isModified={isModified('fillColor') || isModified('fillOpacity')}
        onChange={fillColor => props.onStyle({fillColor})}
        onReset={() => props.onResetStyle(['fillColor', 'fillOpacity'])}
        opacity={{
          value: style?.fillOpacity ?? 0,
          onChange: fillOpacity => props.onStyle({fillOpacity}),
          onPreview: fillOpacity =>
            props.onStylePreview(fillOpacity !== null ? {fillOpacity} : null),
          onReset: () => props.onResetStyle(['fillOpacity']),
        }}
        onPreview={fillColor =>
          props.onStylePreview(fillColor ? {fillColor} : null)
        }
        onHide={onPopoverHide}
      />
      <ColorPopover
        ref={popoverRefs[BarPopover.Border]}
        header={isLine ? 'Line' : 'Border'}
        color={style?.borderColor ?? NO_COLOR}
        isModified={isModified('borderColor')}
        onChange={borderColor => props.onStyle({borderColor})}
        onReset={() => props.onResetStyle(['borderColor'])}
        onPreview={borderColor =>
          props.onStylePreview(borderColor ? {borderColor} : null)
        }
        onHide={onPopoverHide}
      />
      <WidthPopover
        ref={popoverRefs[BarPopover.Width]}
        header={isLine ? 'Line width' : 'Border width'}
        value={style?.borderWidth ?? 1}
        isModified={isModified('borderWidth')}
        onChange={borderWidth => props.onStyle({borderWidth})}
        onReset={() => props.onResetStyle(['borderWidth'])}
        onHide={onPopoverHide}
      />
      <SliderPopover
        ref={popoverRefs[BarPopover.Radius]}
        header="Corner radius"
        value={cornerRadius}
        min={0}
        max={maxRadius}
        suffix=" px"
        isModified={isModified('cornerRadius')}
        onReset={() => props.onResetStyle(['cornerRadius'])}
        onChange={cornerRadius => props.onStyle({cornerRadius})}
        onPreview={cornerRadius =>
          props.onStylePreview(cornerRadius !== null ? {cornerRadius} : null)
        }
        onHide={onPopoverHide}
      />
    </div>
  );
});

// Colors that aren't drawn show the swatch for no color instead
function swatchColor(color?: string) {
  return color && color !== NO_COLOR ? color : undefined;
}

export default SelectionBar;
