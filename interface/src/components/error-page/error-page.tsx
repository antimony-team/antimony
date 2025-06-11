import {Button} from 'primereact/button';
import React, {useEffect} from 'react';

import classNames from 'classnames';
import {useNavigate, useRouteError} from 'react-router';
import {ProgressSpinner} from 'primereact/progressspinner';

import {useDataBinder} from '@sb/lib/stores/root-store';
import {Choose, Otherwise, When} from '@sb/types/control';

import './error-page.sass';

interface ErrorPageProps {
  code?: string;
  message?: string;

  isVisible: boolean;
}

const ErrorPage = (props: ErrorPageProps) => {
  const error: Error | null = useRouteError() as Error | null;
  const dataBinder = useDataBinder();

  const navigate = useNavigate();

  useEffect(() => {
    if (!error) return;
    console.error('[ROUTE] Antimony experienced an unexpected error: ', error);
  }, [error]);

  return (
    <div
      className={classNames('sb-error-page-container', 'sb-animated-overlay', {
        visible: props.isVisible,
      })}
    >
      <span className="sb-error-page-code">
        {props.code ?? 'Unexpected Error'}
      </span>
      <span className="sb-error-page-message">
        {props.message ?? 'Whoops, something broke. Please check the logs.'}
      </span>

      <Choose>
        <When condition={dataBinder.hasConnectionError}>
          <div className="sb-error-network-content">
            <div className="sb-error-network-entry">
              <span>Antimony API</span>
              <Choose>
                <When condition={dataBinder.hasAPIError}>
                  <ProgressSpinner strokeWidth="5" />
                </When>
                <Otherwise>
                  <i className="pi pi-check" />
                </Otherwise>
              </Choose>
            </div>
            <div className="sb-error-network-entry">
              <span>Antimony Socket</span>
              <Choose>
                <When condition={!dataBinder.isLoggedIn}>
                  <div className="sb-error-question">
                    <i className="pi pi-question" />
                  </div>
                </When>
                <When condition={dataBinder.hasSocketError}>
                  <ProgressSpinner strokeWidth="5" />
                </When>
                <Otherwise>
                  <i className="pi pi-check" />
                </Otherwise>
              </Choose>
            </div>
          </div>
        </When>
        <When condition={error}>
          <div className="sb-error-stack-content">{error!.stack}</div>
          <Button label="Take me back!" onClick={() => navigate('/')} />
        </When>
      </Choose>
    </div>
  );
};

export default ErrorPage;
