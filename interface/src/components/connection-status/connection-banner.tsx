import React from 'react';

import SBOverlay from '@sb/components/common/sb-overlay/sb-overlay';
import ConnectionStatus from '@sb/components/connection-status/connection-status';

/**
 * Non-blocking notice shown when the connection drops while the user is
 * already logged in. The app stays usable underneath.
 */
const ConnectionBanner = (props: {visible: boolean}) => {
  return (
    <SBOverlay visible={props.visible}>
      <div className="sb-connection-banner">
        <div className="sb-connection-banner-header">
          <i className="pi pi-globe" />
          <i className="pi pi-times-circle sb-connection-banner-icon-overlay" />
          <span>Antimony is experiencing network issues</span>
        </div>
        <ConnectionStatus />
      </div>
    </SBOverlay>
  );
};

export default ConnectionBanner;
