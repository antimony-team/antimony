import React, {useEffect, useState} from 'react';

import SBOverlay from '@sb/components/common/sb-overlay/sb-overlay';

import './loading-screen.sass';
import {Image} from 'primereact/image';

interface LoadingScreenProps {
  visible: boolean;

  /** Describes what the app is currently waiting for. */
  message: string;
}

const LoadingScreen = (props: LoadingScreenProps) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!props.visible) {
      setTimeout(() => setVisible(false), 100);
    }
  }, [props.visible]);

  return (
    <SBOverlay hideDelay={500} fullscreen={true} visible={visible}>
      <div className="sb-loading-screen-panel">
        <span className="sb-loading-screen-title">Antimony Loading</span>
        <span className="sb-loading-screen-text">{props.message}</span>
        <Image
          src="/antimony-loader.svg"
          height="180px"
          alt="Antimony loader"
        />
      </div>
    </SBOverlay>
  );
};

export default LoadingScreen;
