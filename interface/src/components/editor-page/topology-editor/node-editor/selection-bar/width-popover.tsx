import React, {forwardRef} from 'react';

import SelectionPopover, {
  SelectionPopoverRef,
} from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-popover';

const WIDTHS = [1, 1.5, 2, 3, 4];

interface WidthPopoverProps {
  header: string;
  value: number;
  isModified: boolean;

  onChange: (value: number) => void;
  onReset: () => void;
  onHide: () => void;
}

const WidthPopover = forwardRef<SelectionPopoverRef, WidthPopoverProps>(
  (props, ref) => {
    return (
      <SelectionPopover
        ref={ref}
        header={props.header}
        width={168}
        isModified={props.isModified}
        onReset={props.onReset}
        onHide={props.onHide}
      >
        <div className="sb-width-list" role="listbox">
          {WIDTHS.map(width => (
            <button
              key={width}
              role="option"
              aria-selected={width === props.value}
              onClick={() => props.onChange(width)}
            >
              <span
                className="sb-width-list-line"
                style={{height: width, borderRadius: width}}
              />
              {width}
            </button>
          ))}
        </div>
      </SelectionPopover>
    );
  },
);

export default WidthPopover;
