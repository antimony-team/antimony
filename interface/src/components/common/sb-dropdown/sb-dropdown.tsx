import React, {
  forwardRef,
  ReactElement,
  RefObject,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import classNames from 'classnames';
import {Tooltip, TooltipRefProps} from 'react-tooltip';

import {
  Dropdown,
  DropdownChangeEvent,
  DropdownProps,
} from 'primereact/dropdown';
import {SelectItem} from 'primereact/selectitem';

import {If} from '@sb/types/control';

import './sb-dropdown.sass';

interface SBDropdownProps {
  id?: string;
  label?: string;
  isHidden?: boolean;
  wasEdited?: boolean;
  hasFilter?: boolean;
  showClear?: boolean;

  value: unknown;
  icon?:
    | string
    | ReactElement
    | ((option: SelectItem) => string | ReactElement);
  options?: SelectItem[];
  optionGroupLabel?: string;
  optionGroupChildren?: string;
  optionLabel?: string;
  placeholder?: string;
  emptyMessage?: string;
  filterPlaceholder?: string;

  disabled?: boolean;

  className?: string;

  useItemTemplate?: boolean;
  useSelectTemplate?: boolean;

  onValueSubmit: (value: string) => void;
}

export interface SBDropdownRef {
  setValidationError: (msg: string) => void;
  input: RefObject<HTMLSelectElement | null>;
}

const SBDropdown = forwardRef<SBDropdownRef, SBDropdownProps>((props, ref) => {
  const [validationError, setValidationError] = useState<string | null>(null);

  const inputId = useId();

  const inputFieldRef = useRef<HTMLSelectElement>(null);
  const tooltipRef = useRef<TooltipRefProps>(null);

  useImperativeHandle(ref, () => {
    return {
      setValidationError(msg: string) {
        setValidationError(msg);
      },
      input: inputFieldRef,
    };
  }, []);

  function onValueSubmit(event: DropdownChangeEvent) {
    setValidationError(null);
    props.onValueSubmit(event.value);
  }

  const dropdownTemplate = (
    option: SelectItem & {prefix?: string},
    dropdownProps?: DropdownProps,
    isValue = false,
  ) => {
    if (!option) {
      return (
        <span className="sb-dropdown-value sb-dropdown-placeholder">
          {dropdownProps?.placeholder ?? '\u00a0'}
        </span>
      );
    }

    let icon: ReactElement;

    if (typeof props.icon === 'string') {
      // Provided icon is a name of a prime icon
      icon = <i className={`pi ${props.icon as string}`}></i>;
    } else if (typeof props.icon === 'function') {
      // Provided icon is a function to compute the icon
      const computedIcon = (
        props.icon as (option: SelectItem) => string | ReactElement
      )(option);

      if (typeof computedIcon === 'string') {
        // Icon compute function returns a name of a prime icon
        icon = <i className={`pi ${computedIcon as string}`}></i>;
      } else {
        // Icon compute function returns a React element
        icon = computedIcon as ReactElement;
      }
    } else {
      // Provided icon is a React element
      icon = props.icon as ReactElement;
    }

    return (
      <div className="flex align-items-center gap-2">
        <If condition={props.icon}>{icon}</If>
        <If condition={isValue && option.prefix}>
          <span className="sb-dropdown-value-prefix">{option.prefix} /</span>
        </If>
        <span>{option.label ?? option.value}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-column gap-2">
      <If condition={props.id && props.label}>
        <label className="sb-dropdown-label" htmlFor={props.id}>
          {props.label}
        </label>
      </If>
      <Tooltip
        id={inputId}
        ref={tooltipRef}
        isOpen={!!validationError}
        content={validationError ?? undefined}
        place="right"
      />
      <Dropdown
        inputRef={inputFieldRef}
        disabled={props.disabled}
        inputId={props.id}
        showClear={false}
        value={props.value}
        data-tooltip-id={inputId}
        optionLabel={props.optionLabel}
        optionGroupLabel={props.optionGroupLabel}
        optionGroupChildren={props.optionGroupChildren}
        placeholder={props.placeholder}
        options={props.options}
        filter={props.hasFilter}
        resetFilterOnHide={true}
        emptyMessage={props.emptyMessage}
        filterPlaceholder={props.filterPlaceholder ?? 'Search...'}
        onChange={onValueSubmit}
        itemTemplate={
          props.useItemTemplate
            ? (option: SelectItem) => dropdownTemplate(option)
            : undefined
        }
        valueTemplate={
          props.useSelectTemplate
            ? (option: SelectItem, dropdownProps: DropdownProps) =>
                dropdownTemplate(option, dropdownProps, true)
            : undefined
        }
        className={classNames('sb-dropdown', props.className, {
          'sb-dropdown-error': !!validationError,
          'sb-dropdown-hidden': props.isHidden,
        })}
      />
    </div>
  );
});

export default SBDropdown;
