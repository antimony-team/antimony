import React, {
  MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import {Slider} from 'primereact/slider';

import SBScrubNumber from '@sb/components/common/sb-scrub-number/sb-scrub-number';

interface SelectionSliderProps {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  ariaLabel: string;

  onChange: (value: number) => void;

  // Called while the value is dragged, null resets the preview
  onPreview: (value: number | null) => void;
  onReset?: () => void;
}

/**
 * A slider with a number field next to it. Values above the end of the slider
 * are shown as the end of the slider.
 */
const SelectionSlider = (props: SelectionSliderProps) => {
  const [draftValue, setDraftValue] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);

  const value = Math.min(props.max, draftValue ?? props.value);

  // A saved value replaces the one that was dragged
  useEffect(() => setDraft(null), [props.value]);

  function setDraft(value: number | null) {
    draftRef.current = value;
    setDraftValue(value);
  }

  function commit() {
    if (draftRef.current === null) return;

    props.onChange(draftRef.current);
    props.onPreview(null);
    draftRef.current = null;
  }

  /**
   * A press on the track sets the value right away and can be dragged from
   * there, the slider would only set it once the click ends.
   */
  function onTrackMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const track = event.currentTarget.querySelector<HTMLElement>('.p-slider');
    if (
      event.button !== 0 ||
      !track?.contains(target) ||
      target.closest('.p-slider-handle')
    ) {
      return;
    }

    event.preventDefault();

    const onMove = (moveEvent: MouseEvent | ReactMouseEvent) => {
      const rect = track.getBoundingClientRect();
      const fraction = Math.min(
        1,
        Math.max(0, (moveEvent.clientX - rect.left) / rect.width),
      );
      const value = Math.round(props.min + fraction * (props.max - props.min));

      setDraft(value);
      props.onPreview(value);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      commit();
    };

    onMove(event);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, {once: true});
  }

  return (
    <div
      className="sb-selection-slider"
      onMouseDownCapture={onTrackMouseDown}
      onClickCapture={event => {
        if (!(event.target as HTMLElement).closest('.p-slider-handle')) {
          event.stopPropagation();
        }
      }}
      onKeyUp={commit}
    >
      <Slider
        value={value}
        min={props.min}
        max={props.max}
        onChange={event => {
          setDraft(event.value as number);
          props.onPreview(event.value as number);
        }}
        onSlideEnd={commit}
        aria-label={props.ariaLabel}
      />
      <SBScrubNumber
        value={value}
        min={props.min}
        max={props.max}
        suffix={props.suffix}
        ariaLabel={props.ariaLabel}
        onChange={props.onPreview}
        onChangeEnd={value => {
          props.onChange(value);
          props.onPreview(null);
        }}
        onReset={props.onReset}
      />
    </div>
  );
};

export default SelectionSlider;
