import React from 'react';

import {DNA} from 'react-loader-spinner';

import SBOverlay from '@sb/components/common/sb-overlay/sb-overlay';

import './loading-screen.sass';

interface LoadingScreenProps {
  visible: boolean;

  /** Describes what the app is currently waiting for. */
  message: string;
}

const LoadingScreen = (props: LoadingScreenProps) => {
  return (
    <SBOverlay fullscreen={true} visible={props.visible}>
      <div className="sb-loading-screen-panel">
        <span className="sb-loading-screen-title">Antimony Loading</span>
        <span className="sb-loading-screen-text">{props.message}</span>
        <DNA />
      </div>
    </SBOverlay>
  );
};

export default LoadingScreen;
