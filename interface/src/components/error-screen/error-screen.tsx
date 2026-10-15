import React, {ReactNode} from 'react';

import './error-screen.sass';

interface ErrorScreenProps {
  code?: string;
  message?: string;

  children?: ReactNode;
}

const ErrorScreen = (props: ErrorScreenProps) => {
  return (
    <div className="sb-error-screen">
      <span className="sb-error-screen-code">
        {props.code ?? 'Unexpected Error'}
      </span>
      <span className="sb-error-screen-message">
        {props.message ?? 'Whoops, something broke. Please check the logs.'}
      </span>
      {props.children}
    </div>
  );
};

export default ErrorScreen;
