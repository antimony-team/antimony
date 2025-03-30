import {If} from '@sb/types/control';
import {InstanceState, Lab} from '@sb/types/domain/lab';
import classNames from 'classnames';
import React from 'react';

import './state-indicator.sass';

export const LabStateStatusIcons: Record<InstanceState, string> = {
  [InstanceState.Scheduled]: 'pi pi-calendar',
  [InstanceState.Deploying]: 'pi pi-sync pi-spin',
  [InstanceState.Stopping]: 'pi pi-sync pi-times',
  [InstanceState.Running]: 'pi pi-check',
  [InstanceState.Failed]: 'pi pi-times',
  [InstanceState.Done]: 'pi pi-check',
};

export const getLabStateIconClass = (lab: Lab) => ({
  scheduled: !lab.instance,
  running: lab.instance?.state === InstanceState.Running,
  deploying: lab.instance?.state === InstanceState.Deploying,
  done: lab.instance?.state === InstanceState.Done,
  failed: lab.instance?.state === InstanceState.Failed,
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
        getLabStateIconClass(props.lab)
      )}
    >
      <i
        className={
          LabStateStatusIcons[
            props.lab.instance?.state ?? InstanceState.Scheduled
          ]
        }
      ></i>
      <If condition={props.showText}>
        <span>{InstanceState[props.lab.instance?.state ?? -1]}</span>
      </If>
    </div>
  );
};

export default StateIndicator;
