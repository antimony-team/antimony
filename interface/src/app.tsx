import React, {useEffect, useRef} from 'react';

import {Outlet} from 'react-router';
import {Toast} from 'primereact/toast';
import {observer} from 'mobx-react-lite';
import {PrimeReactProvider} from 'primereact/api';

import {
  RootStoreContext,
  useDataBinder,
  useStatusMessages,
  useRootStore,
} from '@sb/lib/stores/root-store';
import SBConfirm, {
  SBConfirmRef,
} from '@sb/components/common/sb-confirm/sb-confirm';
import {AppPhase} from '@sb/types/types';
import SBDock from '@sb/components/common/sb-dock/sb-dock';
import SBLogin from '@sb/components/common/sb-login/sb-login';
import SBOverlay from '@sb/components/common/sb-overlay/sb-overlay';
import LoadingScreen from '@sb/components/loading-screen/loading-screen';
import ConnectionErrorBanner from '@sb/components/connection-error/connection-error-banner';
import ConnectionErrorOverlay from '@sb/components/connection-error/connection-error-overlay';

import 'primeflex/primeflex.css';
import 'primeicons/primeicons.css';
import 'material-symbols/outlined.css';

import './app.sass';
import 'primereact/resources/themes/lara-dark-blue/theme.css';

/**
 * Root layout of the app.
 *
 * Renders the dock and the active page next to the top-level screens. Which
 * screen is shown is decided exclusively by `RootStore.phase`; the screens
 * themselves are dumb consumers of that value. They all stay mounted so the
 * transitions between them can cross-fade.
 */
const App = observer(() => {
  const toastRef = useRef<Toast>(null);
  const confirmationRef = useRef<SBConfirmRef>(null);

  const rootStore = useRootStore();
  const dataBinder = useDataBinder();
  const statusMessageStore = useStatusMessages();

  const phase = rootStore.phase;

  useEffect(() => {
    statusMessageStore.setToast(toastRef);
    statusMessageStore.setConfirm(confirmationRef);
  }, [statusMessageStore]);

  return (
    <PrimeReactProvider>
      <RootStoreContext.Provider value={rootStore}>
        <SBOverlay
          className="sb-app-container"
          visible={phase === AppPhase.Ready}
        >
          <SBDock />
          <div className="flex flex-grow-1 gap-2 min-h-0">
            <Outlet />
          </div>
        </SBOverlay>

        <SBLogin visible={phase === AppPhase.Unauthenticated} />

        <LoadingScreen
          visible={phase === AppPhase.Connecting || phase === AppPhase.Loading}
          message={
            phase === AppPhase.Connecting
              ? 'Connecting to the server...'
              : 'Loading resources...'
          }
        />

        <ConnectionErrorOverlay visible={phase === AppPhase.Offline} />
        <ConnectionErrorBanner visible={dataBinder.connectionWasInterrupted} />
      </RootStoreContext.Provider>
      <SBConfirm ref={confirmationRef} />
      <Toast ref={toastRef} position="bottom-right" />
    </PrimeReactProvider>
  );
});

export default App;
