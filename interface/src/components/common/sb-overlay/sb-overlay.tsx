import React, {ReactNode, useEffect, useState} from 'react';

import classNames from 'classnames';

import {If} from '@sb/types/control';

import './sb-overlay.sass';

/**
 * Has to be kept in sync with the transition duration of `.sb-animated-overlay`
 * in `sb-base.sass`.
 */
const FADE_DURATION_MS = 200;

interface SBOverlayProps {
  visible: boolean;

  // Additional classes for the overlay element itself.
  className?: string;

  // Whether the overlay should cover the whole screen.
  fullscreen?: boolean;

  hideDelay?: number;

  children: ReactNode;
}

/**
 * An overlay that fades in and out and mounts and unmounts its children.
 */
const SBOverlay = (props: SBOverlayProps) => {
  const [isMounted, setMounted] = useState(props.visible);
  const [visible, setVisible] = useState(props.visible);

  useEffect(() => {
    if (props.visible) {
      setMounted(true);
      setVisible(true);
      return;
    }

    let timeout;

    if (props.hideDelay) {
      timeout = setTimeout(
        () => setMounted(false),
        FADE_DURATION_MS + props.hideDelay,
      );
      setTimeout(() => setVisible(false), props.hideDelay);
    } else {
      timeout = setTimeout(() => setMounted(false), FADE_DURATION_MS);

      setVisible(false);
    }

    return () => clearTimeout(timeout);
  }, [props.visible, props.hideDelay]);

  return (
    <div
      className={classNames('sb-animated-overlay', props.className, {
        visible: visible,
        'fullscreen-surface': props.fullscreen,
      })}
    >
      <If condition={isMounted}>{props.children}</If>
    </div>
  );
};

export default SBOverlay;
