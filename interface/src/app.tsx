import React, {useEffect, useMemo, useRef, useState} from 'react';

import classNames from 'classnames';
import {Toast} from 'primereact/toast';
import {observer} from 'mobx-react-lite';
import {Route, Routes} from 'react-router';
import {PrimeReactProvider} from 'primereact/api';

import {
  RootStoreContext,
  useDataBinder,
  useStatusMessages,
  useRootStore,
  useCollectionStore,
} from '@sb/lib/stores/root-store';
import SBConfirm, {
  SBConfirmRef,
} from '@sb/components/common/sb-confirm/sb-confirm';
import SBDock from '@sb/components/common/sb-dock/sb-dock';
import ErrorPage from '@sb/components/error-page/error-page';
import SBLogin from '@sb/components/common/sb-login/sb-login';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import EditorPage from '@sb/components/editor-page/editor-page';
import DashboardPage from '@sb/components/dashboard-page/dashboard-page';
import SBStatusIndicator from '@sb/components/common/sb-status-indicator/sb-status-indicator';

import './app.sass';
import 'primereact/resources/themes/lara-dark-blue/theme.css';

const App: React.FC = observer(() => {
  const toastRef = useRef<Toast>(null);
  const confirmationRef = useRef<SBConfirmRef>(null);

  const rootStore = useRootStore();
  const dataBinder = useDataBinder();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const [doneLoading, setDoneLoading] = useState(false);

  useEffect(() => {
    if (!notificationStore) return;

    notificationStore.setToast(toastRef);
    notificationStore.setConfirm(confirmationRef);
  }, [notificationStore]);

  useEffect(() => {
    if (!dataBinder.isLoggedIn) setDoneLoading(false);
  }, [dataBinder.isLoggedIn]);

  const hasEditorAccess = useMemo(() => {
    return dataBinder.isAdmin || collectionStore.hasWritableCollections;
  }, [dataBinder.isAdmin, collectionStore.hasWritableCollections]);

  return (
    <PrimeReactProvider>
      <RootStoreContext.Provider value={rootStore}>
        <SBLogin />
        <div
          className={classNames('sb-app-container', 'sb-animated-overlay', {
            visible: doneLoading,
          })}
        >
          <If condition={dataBinder.isLoggedIn}>
            <SBDock />
            <div className="flex flex-grow-1 gap-2 min-h-0">
              <Routes>
                <Choose>
                  {/* Redirect editor and dashboard to editor in offline mode */}
                  <When condition={process.env.IS_OFFLINE}>
                    <Route path="/" element={<EditorPage />} />
                    <Route path="/editor" element={<EditorPage />} />
                  </When>

                  {/* Allow access to dashboard but not editor if user doesn't have access to editor */}
                  <When condition={!hasEditorAccess}>
                    <Route path="/" element={<DashboardPage />} />
                    <Route
                      path="/editor"
                      element={
                        <ErrorPage
                          code="403"
                          message="You do not have access to this page"
                          isVisible={true}
                        />
                      }
                    />
                  </When>

                  {/* Otherwise allow both routes */}
                  <Otherwise>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/editor" element={<EditorPage />} />
                  </Otherwise>
                </Choose>

                <Route
                  path="*"
                  element={
                    <ErrorPage
                      code="404"
                      message="This page does not exist"
                      isVisible={true}
                    />
                  }
                />
              </Routes>
            </div>
          </If>
        </div>
        <SBStatusIndicator setDoneLoading={() => setDoneLoading(true)} />
      </RootStoreContext.Provider>
      <SBConfirm ref={confirmationRef} />
      <Toast ref={toastRef} position="bottom-right" />
    </PrimeReactProvider>
  );
});

export default App;
