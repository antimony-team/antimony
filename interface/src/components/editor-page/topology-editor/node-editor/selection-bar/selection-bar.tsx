import React, {memo, useEffect, useRef, useState} from 'react';

import classNames from 'classnames';

import {Button} from 'primereact/button';
import {Menu} from 'primereact/menu';
import {SelectButton} from 'primereact/selectbutton';
import {Tooltip} from 'primereact/tooltip';

import SBScrubNumber from '@sb/components/common/sb-scrub-number/sb-scrub-number';
import {textEditorId} from '@sb/components/common/topology-graph/text-layer/text-layer';
import {arrangeItems} from '@sb/components/editor-page/topology-editor/node-editor/graph-context-menus';
import ColorPopover from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/color-popover';
import MarkdownToolbar from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/markdown-toolbar';
import {SelectionPopoverRef} from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-popover';
import SliderPopover from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/slider-popover';
import WidthPopover from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/width-popover';
import {
  GraphText,
  LayerItem,
  shapeBox,
  shapeGeometry,
} from '@sb/lib/graph/annotation-geometry';
import {
  AnnotationStyle,
  DEFAULT_TEXT_STYLE,
  defaultStyle,
  groupStyle,
  NO_COLOR,
  shapeStyle,
  textStyle,
} from '@sb/lib/graph/annotation-style';
import {GraphAction, keybindLabel} from '@sb/lib/graph/graph-keybinds';
import {If} from '@sb/types/control';
import {BorderStyle, FreeTextAnnotation} from '@sb/types/domain/topology';

import './selection-bar.sass';

const BORDER_STYLES: BorderStyle[] = ['solid', 'dashed', 'dotted'];

const TEXT_ALIGNS: {
  value: FreeTextAnnotation['textAlign'];
  label: string;
  icon: string;
}[] = [
  {value: 'left', label: 'Align left', icon: 'format_align_left'},
  {value: 'center', label: 'Align center', icon: 'format_align_center'},
  {value: 'right', label: 'Align right', icon: 'format_align_right'},
];

// Distance between the selection and the bar below it
const BAR_GAP = 14;

enum BarPopover {
  Fill,
  Border,
  Width,
  Radius,
  TextColor,
  TextBackground,
}

interface SelectionBarProps {
  isVisible: boolean;

  // Set if the selection is exactly one group or shape
  item: LayerItem | null;

  // Set if the selection is exactly one text
  text: GraphText | null;
  isEditingText: boolean;

  canGroup: boolean;
  canReorder: boolean;

  onGroup: () => void;
  onStyle: (style: Partial<AnnotationStyle>) => void;
  onStylePreview: (style: Partial<AnnotationStyle> | null) => void;
  onResetStyle: (fields: (keyof AnnotationStyle)[]) => void;

  // Fields that are set to undefined are reset to their default
  onTextStyle: (update: Partial<FreeTextAnnotation>) => void;
  onTextStylePreview: (update: Partial<FreeTextAnnotation> | null) => void;
  onBringToFront: () => void;
  onBringForward: () => void;
  onBringBackward: () => void;
  onSendToBack: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  // Deletes a group with everything inside it
  onDeleteWithContents: () => void;
}

/**
 * The bar below the selected elements of the graph, its parent places it at the
 * bottom center of the selection. It changes how the selected elements look,
 * the context menu holds the remaining commands.
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
    [BarPopover.TextColor]: useRef<SelectionPopoverRef>(null),
    [BarPopover.TextBackground]: useRef<SelectionPopoverRef>(null),
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

  const text = props.text;
  const isEditingText = !!text && props.isEditingText;
  const hasTextStyle = !!text && !isEditingText;
  const currentTextStyle = text ? textStyle(text.annotation) : null;

  const arrangeMenuRef = useRef<Menu>(null);

  // An open popover belongs to the selection it was opened for
  useEffect(() => {
    if (openPopover !== null) popoverRefs[openPopover].current?.hide();
  }, [item?.id, text?.id, isEditingText, props.isVisible]);

  function togglePopover(popover: BarPopover, target: HTMLElement) {
    setOpenPopover(popover);
    popoverRefs[popover].current?.toggle(target);
  }

  function onPopoverHide() {
    setOpenPopover(null);
    props.onStylePreview(null);
    props.onTextStylePreview(null);
  }

  return (
    <div
      className={classNames('sb-selection-bar', {hidden: !props.isVisible})}
      style={{top: BAR_GAP}}
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
          aria-expanded={openPopover === BarPopover.Fill}
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
          aria-expanded={openPopover === BarPopover.Border}
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
          aria-label={isLine ? 'Line style' : 'Border style'}
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
      <If condition={isEditingText}>
        <MarkdownToolbar fieldId={textEditorId(text!.id)} />
      </If>
      <span
        className={classNames('sb-selection-bar-part', {
          hidden: !hasTextStyle,
        })}
      >
        <button
          className={classNames('sb-selection-bar-swatch', {
            active: openPopover === BarPopover.TextColor,
          })}
          onClick={event =>
            togglePopover(BarPopover.TextColor, event.currentTarget)
          }
          data-pr-tooltip="Text color"
          aria-label="Text color"
          aria-expanded={openPopover === BarPopover.TextColor}
        >
          <span
            className="sb-color-swatch"
            style={{backgroundColor: currentTextStyle?.fontColor}}
          />
          <i className="pi pi-chevron-down" />
        </button>
        <button
          className={classNames('sb-selection-bar-swatch', {
            active: openPopover === BarPopover.TextBackground,
          })}
          onClick={event =>
            togglePopover(BarPopover.TextBackground, event.currentTarget)
          }
          data-pr-tooltip="Background"
          aria-label="Background"
          aria-expanded={openPopover === BarPopover.TextBackground}
        >
          <span
            className={classNames('sb-color-swatch', {
              none: currentTextStyle?.backgroundColor === NO_COLOR,
            })}
            style={{
              backgroundColor: swatchColor(currentTextStyle?.backgroundColor),
            }}
          />
          <i className="pi pi-chevron-down" />
        </button>
        <span className="sb-selection-bar-separator" />
        <SBScrubNumber
          value={currentTextStyle?.fontSize ?? DEFAULT_TEXT_STYLE.fontSize}
          min={8}
          max={96}
          icon={<span className="material-symbols-outlined">format_size</span>}
          ariaLabel="Font size"
          onChange={fontSize => props.onTextStylePreview({fontSize})}
          onChangeEnd={fontSize => props.onTextStyle({fontSize})}
          onReset={() => props.onTextStyle({fontSize: undefined})}
        />
        <span className="sb-selection-bar-separator" />
        {TEXT_ALIGNS.map(align => (
          <Button
            key={align.value}
            text
            icon={
              <span className="material-symbols-outlined">{align.icon}</span>
            }
            className={classNames({
              toggled: currentTextStyle?.textAlign === align.value,
            })}
            onClick={() => props.onTextStyle({textAlign: align.value})}
            data-pr-tooltip={align.label}
            aria-label={align.label}
            aria-pressed={currentTextStyle?.textAlign === align.value}
          />
        ))}
      </span>
      <span
        className={classNames('sb-selection-bar-part', {
          hidden: !item && !hasTextStyle,
        })}
      >
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
          hidden: !props.canReorder || isEditingText,
        })}
      >
        <Button
          text
          icon={<span className="material-symbols-outlined">stacks</span>}
          onClick={event => arrangeMenuRef.current?.toggle(event)}
          aria-haspopup
          aria-label="Arrange"
        />
        <Menu
          ref={arrangeMenuRef}
          model={arrangeItems(props)}
          popup
          popupAlignment="left"
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
      <span
        className={classNames('sb-selection-bar-part', {
          hidden: isEditingText,
        })}
      >
        <Button
          text
          icon="pi pi-trash"
          className="sb-selection-bar-delete"
          onClick={isGroup ? props.onDeleteWithContents : props.onDelete}
          data-pr-tooltip={isGroup ? 'Delete group and nodes' : 'Delete'}
          aria-label="Delete"
        />
      </span>
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
      <ColorPopover
        ref={popoverRefs[BarPopover.TextColor]}
        header="Text"
        color={currentTextStyle?.fontColor ?? DEFAULT_TEXT_STYLE.fontColor}
        isModified={text?.annotation.fontColor !== undefined}
        onChange={fontColor => props.onTextStyle({fontColor})}
        onReset={() => props.onTextStyle({fontColor: undefined})}
        onPreview={fontColor =>
          props.onTextStylePreview(fontColor ? {fontColor} : null)
        }
        onHide={onPopoverHide}
      />
      <ColorPopover
        ref={popoverRefs[BarPopover.TextBackground]}
        header="Background"
        color={currentTextStyle?.backgroundColor ?? NO_COLOR}
        isModified={text?.annotation.backgroundColor !== undefined}
        onChange={backgroundColor => props.onTextStyle({backgroundColor})}
        onReset={() => props.onTextStyle({backgroundColor: undefined})}
        onPreview={backgroundColor =>
          props.onTextStylePreview(backgroundColor ? {backgroundColor} : null)
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
