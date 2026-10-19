import React, {
  forwardRef,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {Button} from 'primereact/button';
import {OverlayPanel} from 'primereact/overlaypanel';

import {If} from '@sb/types/control';

import './selection-popover.sass';

export interface SelectionPopoverRef {
  toggle: (target: HTMLElement) => void;
  hide: () => void;
}

interface SelectionPopoverProps {
  header: string;

  // Shown at the end of the header, e.g. the current value
  headerEnd?: ReactNode;

  width: number;
  children: ReactNode;

  // Shows a button to reset the value while it isn't the default
  isModified?: boolean;
  onReset?: () => void;

  onHide?: () => void;
}

/**
 * A popover below a control of the selection bar.
 *
 * It closes on a press outside of it on its own, the overlay panel only closes
 * on the second click outside after a click inside of it.
 */
const SelectionPopover = forwardRef<SelectionPopoverRef, SelectionPopoverProps>(
  (props, ref) => {
    const [isVisible, setVisible] = useState(false);

    const overlayRef = useRef<OverlayPanel>(null);
    const targetRef = useRef<HTMLElement | null>(null);

    useImperativeHandle(ref, () => ({
      toggle: target => {
        targetRef.current = target;
        overlayRef.current?.toggle(null, target);
      },
      hide: () => overlayRef.current?.hide(),
    }));

    useEffect(() => {
      if (!isVisible) return;

      const onMouseDown = (event: MouseEvent) => {
        const target = event.target as Node;
        if (
          overlayRef.current?.getElement()?.contains(target) ||
          targetRef.current?.contains(target)
        ) {
          return;
        }

        overlayRef.current?.hide();
      };

      window.addEventListener('mousedown', onMouseDown, true);
      return () => window.removeEventListener('mousedown', onMouseDown, true);
    }, [isVisible]);

    return (
      <OverlayPanel
        ref={overlayRef}
        className="sb-selection-popover"
        style={{width: props.width}}
        dismissable={false}
        onShow={() => setVisible(true)}
        onHide={() => {
          setVisible(false);
          props.onHide?.();
        }}
      >
        <div className="sb-selection-popover-header">
          <span className="sb-selection-popover-title">{props.header}</span>
          <If condition={props.onReset && props.isModified}>
            <Button
              className="sb-selection-popover-reset"
              icon="pi pi-undo"
              text
              onClick={props.onReset}
              aria-label="Reset to default"
            />
          </If>
          {props.headerEnd}
        </div>
        {props.children}
      </OverlayPanel>
    );
  },
);

export default SelectionPopover;
