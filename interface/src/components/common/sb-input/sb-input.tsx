import React, {FocusEvent, forwardRef, KeyboardEvent, useState} from 'react';

import classNames from 'classnames';
import {InputText} from 'primereact/inputtext';
import {KeyFilterType} from 'primereact/keyfilter';

import {If} from '@sb/types/control';

import './sb-input.sass';

interface SBInputProps {
  id?: string;
  label?: string;
  isHidden?: boolean;
  fullyTransparent?: boolean;

  wasEdited?: boolean;
  defaultValue?: string | null;
  placeholder?: string;
  keyfilter?: KeyFilterType;
  tooltip?: string;
  autoFocus?: boolean;

  doubleClick?: boolean;
  explicitSubmit?: boolean;

  validationError?: string | null;
  onValueSubmit?: (value: string, isImplicit: boolean) => string | null | void;
}

const SBInput = forwardRef<HTMLInputElement, SBInputProps>((props, ref) => {
  const [isEditing, setEditing] = useState(false);
  const [content, setContent] = useState(props.defaultValue);
  const [validationError, setValidationError] = useState<string | null>(null);

  function onValueSubmit(value: string, isImplicit: boolean) {
    if (!props.onValueSubmit || (isImplicit && value === props.defaultValue)) {
      setEditing(false);
      return;
    }

    const error = props.onValueSubmit(value, isImplicit);
    if (error) setValidationError(error);

    if (!error) setEditing(false);
  }

  function onBlur(event: FocusEvent<HTMLInputElement>) {
    if (props.explicitSubmit) {
      setEditing(false);
      setContent(props.defaultValue);
      return;
    }

    onValueSubmit(event.target.value, true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      onValueSubmit((event.target as HTMLInputElement).value, false);
    }
  }

  function onSingleClick() {
    if (props.doubleClick) return;
    onEnterEditing();
  }

  function onEnterEditing() {
    if (validationError === null) {
      setEditing(true);
    }
  }

  return (
    <div className="flex flex-column gap-2">
      <If condition={props.id && props.label}>
        <label className="sb-input-label" htmlFor={props.id}>
          {props.label}
        </label>
      </If>
      <InputText
        ref={ref}
        onClick={onSingleClick}
        capture={false}
        onDoubleClick={onEnterEditing}
        onChange={e => setContent(e.target.value)}
        disabled={false}
        value={content}
        autoFocus={props.autoFocus}
        className={classNames('sb-input', {
          'sb-input-disabled': !isEditing && props.isHidden,
          'sb-input-error': !!validationError || !!props.validationError,
          'sb-input-hidden': props.isHidden,
        })}
        keyfilter={props.keyfilter}
        placeholder={props.placeholder}
        readOnly={!isEditing && props.isHidden}
        tooltip={
          validationError ?? props.validationError ?? props.tooltip ?? undefined
        }
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
    </div>
  );
});

export default SBInput;
