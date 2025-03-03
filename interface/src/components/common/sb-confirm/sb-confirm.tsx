import React, {
  forwardRef,
  ReactNode,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {Button} from 'primereact/button';
import {ConfirmDialog} from 'primereact/confirmdialog';

import './sb-confirm.sass';

interface SBConfirmProps {}

export interface SBConfirmOpenProps extends SBConfirmState {
  message?: string;
  header?: string;
}

export interface SBConfirmRef {
  show: (confirm: SBConfirmOpenProps) => void;
}

interface SBConfirmState {
  onAccept?: () => void;
  onReject?: () => void;

  message?: string;
  content?: ReactNode;
  header?: string;
  icon?: string;
  severity?:
    | 'secondary'
    | 'success'
    | 'info'
    | 'warning'
    | 'danger'
    | 'help'
    | 'contrast';

  acceptText?: string;
  rejectText?: string;
}

const SBConfirm = forwardRef<SBConfirmRef, SBConfirmProps>((props, ref) => {
  const [isOpen, setOpen] = useState(false);

  const dialogState = useRef<SBConfirmState>();

  useImperativeHandle(ref, () => ({
    show: (props: SBConfirmOpenProps) => {
      dialogState.current = {
        ...props,
        icon: props.icon ?? 'pi pi-question',
        acceptText: props.acceptText ?? 'Ok',
        rejectText: props.rejectText ?? 'Cancel',
      };
      setOpen(true);
    },
  }));

  function getIconClass() {
    const baseClass = dialogState.current?.icon + ' text-5xl';
    if (!dialogState.current?.severity) return baseClass;

    return `${baseClass} pi-severity-${dialogState.current.severity}`;
  }

  return (
    <ConfirmDialog
      group="headless"
      visible={isOpen}
      dismissableMask={true}
      closeOnEscape={true}
      onHide={() => setOpen(false)}
      content={() => (
        <div className="flex flex-column align-items-center p-4">
          <div className="border-circle bg-primary inline-flex justify-content-center align-items-center h-6rem w-6rem -mt-8">
            <i className={getIconClass()}></i>
          </div>
          <span className="font-bold text-2xl block mb-2 mt-4">
            {dialogState.current?.header}
          </span>
          <span className="mb-0">
            {dialogState.current?.message ?? dialogState.current?.content}
          </span>
          <div className="flex align-items-center gap-3 mt-4">
            <Button
              label={dialogState.current?.rejectText}
              outlined
              onClick={() => {
                setOpen(false);
                dialogState.current?.onReject?.call(null);
              }}
              className="w-8rem"
              aria-label={dialogState.current?.rejectText ?? 'Reject'}
            />
            <Button
              label={dialogState.current?.acceptText}
              onClick={() => {
                setOpen(false);
                dialogState.current?.onAccept?.call(null);
              }}
              severity={dialogState.current?.severity}
              className="w-8rem"
              aria-label={dialogState.current?.acceptText ?? 'Accept'}
            />
          </div>
        </div>
      )}
    />
  );
});

export default SBConfirm;
