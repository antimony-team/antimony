import React, {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useRef,
  useState,
} from 'react';

import classNames from 'classnames';

import {InputNumber} from 'primereact/inputnumber';

import './sb-scrub-number.sass';

// Moving the mouse by less than this many pixels counts as a click
const SCRUB_THRESHOLD = 3;

interface SBScrubNumberProps {
  value: number;
  min?: number;
  max?: number;

  // The change of the value per pixel dragged
  step?: number;

  suffix?: string;
  icon?: ReactNode;
  disabled?: boolean;

  // Highlights the field, e.g. while its popover is open
  isActive?: boolean;
  ariaLabel: string;

  // Called while the value is dragged, the value is only final once it ends
  onChange?: (value: number) => void;
  onChangeEnd: (value: number) => void;

  // Called on a click without dragging instead of making the field editable
  onClick?: (target: HTMLElement) => void;

  // Called on a right-click, to reset the value to its default
  onReset?: () => void;
}

/**
 * A number field that changes its value when it is dragged up or down, with
 * shift ten times as fast and with alt ten times as slow. A click without
 * dragging makes it editable, a right-click resets it.
 */
const SBScrubNumber = (props: SBScrubNumberProps) => {
  const [isEditing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState<number | null>(null);

  const containerRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const step = props.step ?? 1;
  const fractionDigits = Math.max(0, -Math.floor(Math.log10(step)));
  const value = draftValue ?? props.value;

  // Wide enough for the largest value, so the field doesn't change its width
  const largestValue = Math.max(
    Math.abs(props.max ?? value),
    Math.abs(props.min ?? value),
  );
  const width =
    String(Math.trunc(largestValue)).length +
    (fractionDigits > 0 ? fractionDigits + 1 : 0) +
    (props.suffix?.length ?? 0);

  function limit(value: number) {
    return Math.min(
      props.max ?? Infinity,
      Math.max(props.min ?? -Infinity, value),
    );
  }

  // Rounds the value to the step and keeps it within the limits
  function toStep(value: number) {
    return limit(
      Number((Math.round(value / step) * step).toFixed(fractionDigits)),
    );
  }

  function onMouseDown(event: ReactMouseEvent) {
    if (event.button !== 0 || isEditing || props.disabled) return;

    event.preventDefault();

    let lastY = event.clientY;
    let current = props.value;
    // Not rounded, so slow drags with alt add up to a step
    let unrounded = props.value;
    let isScrubbing = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (
        !isScrubbing &&
        Math.abs(moveEvent.clientY - event.clientY) < SCRUB_THRESHOLD
      ) {
        return;
      }

      const factor = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
      unrounded = limit(
        unrounded + (lastY - moveEvent.clientY) * step * factor,
      );
      current = toStep(unrounded);
      lastY = moveEvent.clientY;
      isScrubbing = true;

      setDraftValue(current);
      props.onChange?.(current);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (isScrubbing) {
        setDraftValue(null);
        props.onChangeEnd(current);
      } else if (props.onClick) {
        props.onClick(containerRef.current!);
      } else {
        startEditing();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function startEditing() {
    setEditing(true);
    setDraftValue(props.value);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function stopEditing(isSubmit: boolean) {
    if (!isEditing) return;

    setEditing(false);
    setDraftValue(null);
    if (isSubmit && draftValue !== null && draftValue !== props.value) {
      props.onChangeEnd(toStep(draftValue));
    }
  }

  return (
    <span
      ref={containerRef}
      className={classNames('sb-scrub-number', {
        editing: isEditing,
        active: props.isActive,
        disabled: props.disabled,
      })}
      onMouseDown={onMouseDown}
      onContextMenu={event => {
        if (!props.onReset || props.disabled) return;

        event.preventDefault();
        stopEditing(false);
        props.onReset();
      }}
    >
      {props.icon}
      <InputNumber
        inputRef={inputRef}
        value={value}
        min={props.min}
        max={props.max}
        minFractionDigits={0}
        maxFractionDigits={fractionDigits}
        suffix={props.suffix}
        readOnly={!isEditing}
        disabled={props.disabled}
        inputStyle={{width: `${width}ch`}}
        aria-label={props.ariaLabel}
        onValueChange={e => setDraftValue(e.value ?? null)}
        onBlur={() => stopEditing(true)}
        onKeyDown={event => {
          // Enter on the focused field does what a click does
          if (!isEditing && event.key === 'Enter') {
            if (props.onClick) props.onClick(containerRef.current!);
            else startEditing();
            return;
          }

          if (event.key === 'Enter') stopEditing(true);
          if (event.key === 'Escape') stopEditing(false);
        }}
      />
    </span>
  );
};

export default SBScrubNumber;
