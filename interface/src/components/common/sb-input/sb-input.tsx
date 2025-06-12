import React, {
  FocusEvent,
  forwardRef,
  KeyboardEvent,
  RefObject,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {Tooltip, TooltipRefProps} from 'react-tooltip';

import classNames from 'classnames';
import {InputText} from 'primereact/inputtext';
import {KeyFilterType} from 'primereact/keyfilter';

import {If} from '@sb/types/control';

import './sb-input.sass';

export interface SBInputRef {
  setValidationError: (msg: string) => void;
  input: RefObject<HTMLInputElement>;
}

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
  ignoreBlurSubmit?: boolean;

  onValueSubmit?: (
    value: string,
    isImplicit: boolean,
  ) => Promise<string | null | void> | string | null | void;
}

const SBInput = forwardRef<SBInputRef, SBInputProps>((props, ref) => {
  const inputFieldRef = useRef<HTMLInputElement>(null);

  const [isEditing, setEditing] = useState(false);
  const [content, setContent] = useState(props.defaultValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputId = useId();

  const tooltipRef = useRef<TooltipRefProps>(null);

  useImperativeHandle(ref, () => {
    return {
      setValidationError(msg: string) {
        setValidationError(msg);
      },
      input: inputFieldRef,
    };
  }, []);

  function onValueSubmit(value: string, isImplicit: boolean) {
    if (!props.onValueSubmit || (isImplicit && value === props.defaultValue)) {
      setEditing(false);
      return;
    }

    Promise.resolve(props.onValueSubmit(value, isImplicit)).then(error => {
      if (error) {
        setValidationError(error);
      } else {
        setEditing(false);
      }
    });
  }

  function onBlur(event: FocusEvent<HTMLInputElement>) {
    if (props.ignoreBlurSubmit) {
      setEditing(false);
      setContent(props.defaultValue);
      return;
    }

    onValueSubmit(event.target.value, true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      onValueSubmit((event.target as HTMLInputElement).value, false);
    } else {
      setValidationError(null);
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
      <Tooltip
        id={inputId}
        ref={tooltipRef}
        isOpen={!!validationError}
        content={validationError ?? undefined}
        place="right"
        className="sb-input-validation-tooltip"
      />
      <InputText
        /* Not sure why we have to do this, but this works. */
        ref={inputFieldRef as unknown as RefObject<InputText>}
        data-tooltip-id={inputId}
        onClick={onSingleClick}
        onDoubleClick={onEnterEditing}
        onChange={e => setContent(e.target.value)}
        capture={false}
        disabled={false}
        value={content}
        autoFocus={props.autoFocus}
        className={classNames('sb-input', {
          'sb-input-disabled': !isEditing && props.isHidden,
          'sb-input-error': !!validationError,
          'sb-input-hidden': props.isHidden,
        })}
        keyfilter={props.keyfilter}
        placeholder={props.placeholder}
        readOnly={!isEditing && props.isHidden}
        onBlur={onBlur}
        tooltip={props.tooltip}
        onKeyDown={onKeyDown}
      />
    </div>
  );
});

export default SBInput;
