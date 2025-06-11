import {If} from '@sb/types/control';
import {InstanceState, Lab} from '@sb/types/domain/lab';
import classNames from 'classnames';
import React from 'react';

import './state-indicator.sass';

export const LabStateStatusIcons: Record<InstanceState, string> = {
  [InstanceState.Deploying]: 'pi pi-sync pi-spin',
  [InstanceState.Running]: 'pi pi-check',
  [InstanceState.Stopping]: 'pi pi-sync pi-spin',
  [InstanceState.Failed]: 'pi pi-exclamation-triangle',
  [InstanceState.Inactive]: 'pi pi-times',
  [InstanceState.Scheduled]: 'pi pi-calendar',
};

export const getLabStateIconClass = (lab: Lab) => ({
  running: lab.state === InstanceState.Running,
  deploying: lab.state === InstanceState.Deploying,
  stopping: lab.state === InstanceState.Stopping,
  failed: lab.state === InstanceState.Failed,
  inactive: lab.state === InstanceState.Inactive,
  scheduled: lab.state === InstanceState.Scheduled,
});

interface StateIndicatorProps {
  lab: Lab;
  showText: boolean;
}

const StateIndicator = (props: StateIndicatorProps) => {
  return (
    <div
      className={classNames(
        'lab-state-label-icon',
        getLabStateIconClass(props.lab),
      )}
    >
      <i className={LabStateStatusIcons[props.lab.state]}></i>
      <If condition={props.showText}>
        <span>{InstanceState[props.lab.state]}</span>
      </If>
    </div>
  );
};

export default StateIndicator;
