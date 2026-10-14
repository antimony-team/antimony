import React, {forwardRef, useRef, useState} from 'react';

import classNames from 'classnames';

import {Button} from 'primereact/button';
import {ColorPicker} from 'primereact/colorpicker';

import SBInput from '@sb/components/common/sb-input/sb-input';
import SelectionPopover, {
  SelectionPopoverRef,
} from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-popover';
import SelectionSlider from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-slider';
import {NO_COLOR} from '@sb/lib/graph/annotation-style';
import {Choose, If, Otherwise, When} from '@sb/types/control';

// The first row matches the colors of the app, the second row are grays
const PRESET_COLORS = [
  '#3fcfad',
  '#5b8def',
  '#b859cd',
  '#e75a9b',
  '#ff5c6c',
  '#e8a44a',
  '#e3d35b',
  '#80e163',
  NO_COLOR,
  '#ffffff',
  '#c7c8cc',
  '#8b8d94',
  '#5c5e66',
  '#3a3c43',
  '#26272d',
  '#000000',
];

// A hex color with an optional alpha channel
const HEX_COLOR = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i;

interface ColorPopoverProps {
  header: string;
  color: string;
  isModified: boolean;

  onChange: (color: string) => void;
  onReset: () => void;

  // Called while a custom color is picked, null resets the preview
  onPreview: (color: string | null) => void;
  onHide: () => void;

  // Shows a slider for the opacity of the color if set, from 0 to 100
  opacity?: {
    value: number;
    onChange: (opacity: number) => void;
    onPreview: (opacity: number | null) => void;
    onReset: () => void;
  };
}

/**
 * Preset colors and a field for a hex color. The custom color picker opens in
 * place of the presets.
 */
const ColorPopover = forwardRef<SelectionPopoverRef, ColorPopoverProps>(
  (props, ref) => {
    const [isCustom, setCustom] = useState(false);
    const pickedColor = useRef<string | null>(null);

    const hexMatch = HEX_COLOR.exec(props.color);
    const hexColor = hexMatch?.[1] ?? null;

    function commitPickedColor() {
      if (pickedColor.current === null) return;

      props.onChange(pickedColor.current);
      props.onPreview(null);
      pickedColor.current = null;
    }

    // The picker reports the color while it is dragged, it is saved once it is released
    function onPickerMouseDown() {
      window.addEventListener('mouseup', commitPickedColor, {once: true});
    }

    function onHexSubmit(value: string) {
      const match = HEX_COLOR.exec(value.trim());
      if (!match) return 'Enter a color like #5b8def';

      props.onChange(`#${match[1]}${match[2] ?? ''}`.toLowerCase());
      return null;
    }

    return (
      <SelectionPopover
        ref={ref}
        header={props.header}
        headerEnd={
          <If condition={isCustom}>
            <span className="sb-selection-popover-hint">Custom</span>
          </If>
        }
        width={244}
        isModified={props.isModified}
        onReset={props.onReset}
        onHide={() => {
          commitPickedColor();
          setCustom(false);
          props.onHide();
        }}
      >
        <Choose>
          <When condition={isCustom}>
            <div className="sb-color-picker" onMouseDown={onPickerMouseDown}>
              <ColorPicker
                inline
                format="hex"
                value={hexColor ?? '3fcfad'}
                onChange={event => {
                  pickedColor.current = `#${event.value as string}`;
                  props.onPreview(pickedColor.current);
                }}
              />
            </div>
          </When>
          <Otherwise>
            <div className="sb-color-palette" role="listbox">
              {PRESET_COLORS.map(color => (
                <button
                  key={color}
                  role="option"
                  aria-selected={color === props.color}
                  aria-label={color === NO_COLOR ? 'No color' : color}
                  className={classNames('sb-color-swatch', {
                    selected: color === props.color,
                    none: color === NO_COLOR,
                  })}
                  style={
                    color !== NO_COLOR ? {backgroundColor: color} : undefined
                  }
                  onMouseDown={event => {
                    if (event.button !== 0) return;

                    event.preventDefault();
                    props.onChange(color);
                  }}
                />
              ))}
            </div>
          </Otherwise>
        </Choose>
        <If condition={props.opacity && props.color !== NO_COLOR}>
          <span className="sb-selection-popover-label">Opacity</span>
          <SelectionSlider
            value={props.opacity!.value}
            min={0}
            max={100}
            suffix="%"
            ariaLabel="Opacity"
            onChange={props.opacity!.onChange}
            onPreview={props.opacity!.onPreview}
            onReset={props.opacity!.onReset}
          />
        </If>
        <span className="sb-selection-popover-separator" />
        <div className="sb-selection-popover-row">
          <If condition={isCustom}>
            <Button
              text
              icon="pi pi-chevron-left"
              onClick={() => setCustom(false)}
              aria-label="Back to presets"
            />
          </If>
          <SBInput
            key={props.color}
            defaultValue={
              props.color === NO_COLOR
                ? 'None'
                : hexMatch
                  ? `#${hexMatch[1]}${hexMatch[2] ?? ''}`.toUpperCase()
                  : ''
            }
            onValueSubmit={onHexSubmit}
          />
          <If condition={!isCustom}>
            <Button
              text
              icon={<span className="material-symbols-outlined">palette</span>}
              label="Custom"
              onClick={() => setCustom(true)}
            />
          </If>
        </div>
      </SelectionPopover>
    );
  },
);

export default ColorPopover;
