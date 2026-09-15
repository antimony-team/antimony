import React from 'react';

import ErrorScreen from '@sb/components/error-screen/error-screen';
import SBOverlay from '@sb/components/common/sb-overlay/sb-overlay';
import ConnectionStatus from '@sb/components/connection-status/connection-status';

/**
 * Blocking screen shown when the server is unreachable before the user has
 * logged in. There is nothing to fall back to at that point, so it takes over
 * the whole viewport.
 */
const ConnectionScreen = (props: {visible: boolean}) => {
  return (
    <SBOverlay visible={props.visible} fullscreen={true}>
      <ErrorScreen
        code="Network Error"
        message="Unable to connect to the Antimony server."
      >
        <ConnectionStatus className="sb-connection-status-large" />
      </ErrorScreen>
    </SBOverlay>
  );
};

export default ConnectionScreen;
