import React from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {ProgressSpinner} from 'primereact/progressspinner';

import {ConnectionState} from '@sb/types/types';
import {useDataBinder} from '@sb/lib/stores/root-store';
import {Choose, Otherwise, When} from '@sb/types/control';

import './connection-status.sass';

const ConnectionStateIcon = (props: {state: ConnectionState}) => {
  return (
    <Choose>
      <When condition={props.state === ConnectionState.Retrying}>
        <ProgressSpinner strokeWidth="5" />
      </When>
      <When condition={props.state === ConnectionState.Unknown}>
        <i className="pi pi-question" />
      </When>
      <Otherwise>
        <i className="pi pi-check" />
      </Otherwise>
    </Choose>
  );
};

interface ConnectionStatusProps {
  /** Pass 'sb-connection-status-large' for the full-screen variant. */
  className?: string;
}

/**
 * Lists the state of every backend connection.
 *
 * Shared by the connection banner and the connection screen so both always
 * agree on what they show.
 */
const ConnectionStatus = observer((props: ConnectionStatusProps) => {
  const dataBinder = useDataBinder();

  return (
    <div className={classNames('sb-connection-status', props.className)}>
      <div className="sb-connection-status-entry">
        <span>Antimony API</span>
        <ConnectionStateIcon state={dataBinder.apiState} />
      </div>
      <div className="sb-connection-status-entry">
        <span>Antimony Socket</span>
        <ConnectionStateIcon state={dataBinder.socketState} />
      </div>
    </div>
  );
});

export default ConnectionStatus;
