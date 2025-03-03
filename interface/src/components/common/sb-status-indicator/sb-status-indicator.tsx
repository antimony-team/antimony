import React, {useEffect, useState} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {DNA} from 'react-loader-spinner';
import {ProgressSpinner} from 'primereact/progressspinner';

import {FetchState} from '@sb/types/types';
import {Choose, Otherwise, When} from '@sb/types/control';
import ErrorPage from '@sb/components/error-page/error-page';
import {useDataBinder, useRootStore} from '@sb/lib/stores/root-store';
import {RemoteDataBinder} from '@sb/lib/stores/data-binder/remote-data-binder';

import './sb-status-indicator.sass';

interface SBStatusIndicatorProps {
  setDoneLoading: () => void;
}

const SBStatusIndicator = observer((props: SBStatusIndicatorProps) => {
  const dataBinder = useDataBinder();
  const rootStore = useRootStore();

  const [loaderVisible, setLoaderVisible] = useState(false);

  const errorPanelVisible =
    dataBinder.hasConnectionError && dataBinder.isLoggedIn;
  const errorOverlayVisible =
    dataBinder.hasConnectionError && !dataBinder.isLoggedIn;

  useEffect(() => {
    const isDone = rootStore.fetchState === FetchState.Done;
    if (dataBinder.isLoggedIn && !isDone && !loaderVisible) {
      setLoaderVisible(true);
    } else if (dataBinder.isLoggedIn && isDone && loaderVisible) {
      setTimeout(() => {
        setLoaderVisible(false);
        props.setDoneLoading();
      }, 0);
    }
  }, [
    dataBinder.hasConnectionError,
    dataBinder.isLoggedIn,
    loaderVisible,
    props,
    rootStore.fetchState,
  ]);

  return (
    <>
      <ErrorPage
        code="Network Error"
        message="Antimony was unable to reach some network resources."
        isVisible={errorOverlayVisible}
      />
      <div
        className={classNames('sb-indicator-container', 'sb-animated-overlay', {
          visible: loaderVisible,
        })}
      >
        <div className="sb-indicator-loader-panel">
          <span className="sb-indicator-loader-panel-title">
            Antimony Loading
          </span>
          <DNA />
        </div>
      </div>
      <div
        className={classNames('sb-animated-overlay', {
          visible: errorPanelVisible,
        })}
      >
        <div className="sb-indicator-error-panel">
          <div className="sb-indicator-error-header">
            <i className="pi pi-globe" />
            <i className="pi pi-times-circle sb-indicator-error-icon-overlay" />
            <span>Antimony is experiencing network issues</span>
          </div>
          <div className="sb-indicator-error-content">
            <div className="sb-indicator-error-entry">
              <span>Antimony API</span>
              <Choose>
                <When condition={(dataBinder as RemoteDataBinder).hasAPIError}>
                  <ProgressSpinner strokeWidth="5" />
                </When>
                <Otherwise>
                  <i className="pi pi-check" />
                </Otherwise>
              </Choose>
            </div>
            <div className="sb-indicator-error-entry">
              <span>Antimony Socket</span>
              <Choose>
                <When
                  condition={(dataBinder as RemoteDataBinder).hasSocketError}
                >
                  <ProgressSpinner strokeWidth="5" />
                </When>
                <Otherwise>
                  <i className="pi pi-check" />
                </Otherwise>
              </Choose>
            </div>
            <div className="sb-indicator-error-entry">
              <span>External Resources</span>
              <Choose>
                <When condition={dataBinder.hasExternalError}>
                  <ProgressSpinner strokeWidth="5" />
                </When>
                <Otherwise>
                  <i className="pi pi-check" />
                </Otherwise>
              </Choose>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});

export default SBStatusIndicator;
