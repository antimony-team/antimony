import React, {forwardRef} from 'react';

import SelectionPopover, {
  SelectionPopoverRef,
} from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-popover';
import SelectionSlider from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-slider';

interface SliderPopoverProps {
  header: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;

  // Shows a reset button while the value isn't the default
  isModified?: boolean;
  onReset?: () => void;

  onChange: (value: number) => void;

  // Called while the slider is dragged, null resets the preview
  onPreview: (value: number | null) => void;
  onHide: () => void;
}

const SliderPopover = forwardRef<SelectionPopoverRef, SliderPopoverProps>(
  (props, ref) => {
    return (
      <SelectionPopover
        ref={ref}
        header={props.header}
        width={220}
        isModified={props.isModified}
        onReset={props.onReset}
        onHide={() => {
          props.onPreview(null);
          props.onHide();
        }}
      >
        <SelectionSlider
          value={props.value}
          min={props.min}
          max={props.max}
          suffix={props.suffix}
          ariaLabel={props.header}
          onChange={props.onChange}
          onPreview={props.onPreview}
          onReset={props.onReset}
        />
      </SelectionPopover>
    );
  },
);

export default SliderPopover;
