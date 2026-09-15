import React, {useEffect} from 'react';

import {Button} from 'primereact/button';
import {useRouteError} from 'react-router';

import {If} from '@sb/types/control';
import ErrorScreen from '@sb/components/error-screen/error-screen';
import SBOverlay from '@sb/components/common/sb-overlay/sb-overlay';

/**
 * Fallback screen for when Antimony experienceds an unexpected error.
 */
const RouteErrorBoundary = () => {
  const error = useRouteError() as Error | null;

  useEffect(() => {
    if (!error) return;
    console.error('[ROUTE] Antimony experienced an unexpected error: ', error);
  }, [error]);

  return (
    <SBOverlay visible={true} fullscreen={true}>
      <ErrorScreen>
        <If condition={error}>
          <div className="sb-error-screen-stack">{error!.stack}</div>
        </If>
        <Button
          label="Take me back!"
          onClick={() => window.location.reload()}
        />
      </ErrorScreen>
    </SBOverlay>
  );
};

export default RouteErrorBoundary;
