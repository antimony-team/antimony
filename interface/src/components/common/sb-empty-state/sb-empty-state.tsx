import React, {ReactElement} from 'react';

import classNames from 'classnames';

import {SelectItem} from 'primereact/selectitem';

import {If} from '@sb/types/control';

import './sb-empty-state.sass';

interface EmptyStateProps {
  title: string;
  text: string;

  icon?:
    | string
    | ReactElement
    | ((option: SelectItem) => string | ReactElement);

  accent?: boolean;
  children?: React.ReactNode;
}

const SBEmptyState = (props: EmptyStateProps) => {
  function getIcon() {
    if (typeof props.icon === 'string') {
      // Provided icon is a name of a prime icon
      return <i className={`pi ${props.icon as string}`}></i>;
    }

    // Provided icon is a React element
    return props.icon as ReactElement;
  }

  return (
    <div className="sb-empty-state">
      <span
        className={classNames('sb-empty-state-icon', {accent: props.accent})}
      >
        {getIcon()}
      </span>
      <div className="sb-empty-state-text">
        <span className="sb-empty-state-title">{props.title}</span>
        <span>{props.text}</span>
      </div>
      <If condition={props.children}>
        <div className="sb-empty-state-actions">{props.children}</div>
      </If>
    </div>
  );
};

export default SBEmptyState;
