import React, {
  forwardRef,
  ReactNode,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import './sb-confirm.sass';
import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {If} from '@sb/types/control';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';

export interface SBConfirmOpenProps extends SBConfirmState {
  message?: string;
  header?: string;
}

export interface SBConfirmRef {
  show: (confirm: SBConfirmOpenProps) => void;
}

export type SBConfirmSeverity = 'success' | 'info' | 'warning' | 'danger';

interface SBConfirmState {
  onAccept?: () => void;
  onReject?: () => void;

  message?: string;
  content?: ReactNode;
  header?: string;
  icon?: string;
  severity?: SBConfirmSeverity;

  confirmText?: string;

  acceptText?: string;
  rejectText?: string;
}

const SBConfirm = forwardRef<SBConfirmRef, object>((props, ref) => {
  const [isOpen, setOpen] = useState(false);

  const dialogState = useRef<SBConfirmState>(null);

  const confirmInputRef = useRef<SBInputRef>(null);

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

  function onSubmit() {
    if (!dialogState.current) return;

    if (dialogState.current.confirmText) {
      const userInput = confirmInputRef.current!.input.current!.value;
      if (userInput !== dialogState.current.confirmText) {
        confirmInputRef.current?.setValidationError(
          'Confirmation code does not match',
        );
        return;
      }
    }

    if (dialogState.current.onAccept) {
      dialogState.current.onAccept();
    }
    setOpen(false);
  }

  function getIcon() {
    if (dialogState.current?.icon) {
      return `${dialogState.current.icon} pi-severity-${dialogState.current.severity}`;
    }

    switch (dialogState.current?.severity) {
      case 'success':
        return 'pi pi-check pi-severity-success';
      case 'info':
        return 'pi pi-info-circle pi-severity-info';
      case 'warning':
        return 'pi pi-exclamation-triangle pi-severity-warning';
      case 'danger':
        return 'pi pi-times-circle pi-severity-danger';
      default:
        return 'pi pi-times-circle pi-severity-danger';
    }
  }

  return (
    <SBDialog
      className={`sb-confirm-dialog ${dialogState.current?.severity}`}
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      headerTitle={dialogState.current?.header}
      headerIcon={<i className={getIcon()}></i>}
      submitLabel={dialogState.current?.acceptText}
      cancelLabel={dialogState.current?.rejectText}
      onSubmit={onSubmit}
      onCancel={() => {
        if (dialogState.current?.onReject) {
          dialogState.current.onReject();
        }
        setOpen(false);
      }}
    >
      <If condition={dialogState.current}>
        <span className="sb-confirm-dialog-message">
          {dialogState.current!.message}
        </span>
        <If condition={dialogState.current!.confirmText}>
          <div className="flex flex-column gap-2">
            <div className="sb-confirm-dialog-confirm-label">
              <span>Type</span>
              <span className="sb-confirm-dialog-confirm-code">
                {dialogState.current!.confirmText}
              </span>
              <span>to confirm</span>
            </div>
            <SBInput ref={confirmInputRef} />
          </div>
        </If>
      </If>
    </SBDialog>
  );
});

export const SBConfirmDeletePreset: (type: string) => SBConfirmState = (
  type: string,
) => ({
  header: `Delete ${type}`,
  icon: 'pi pi-trash',
  severity: 'danger' as SBConfirmSeverity,
  acceptText: `Delete ${type}`,
  rejectText: 'Cancel',
});

export default SBConfirm;
