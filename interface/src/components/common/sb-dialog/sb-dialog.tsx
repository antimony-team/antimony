import React from 'react';

import {Image} from 'primereact/image';
import {Dialog} from 'primereact/dialog';
import {Button} from 'primereact/button';

import {Choose, If, Otherwise, When} from '@sb/types/control';

import './sb-dialog.sass';

interface SBDialogProps {
  isOpen: boolean;
  onClose: () => void;

  headerTitle: string | React.ReactNode;
  headerIcon?: string;

  children: React.ReactNode;
  className?: string;

  hideButtons?: boolean;
  onCancel?: () => void;
  onSubmit?: () => void;

  cancelLabel?: string;
  submitLabel?: string;

  onShow?: () => void;
}

const SBDialog: React.FC<SBDialogProps> = (props: SBDialogProps) => {
  return (
    <Dialog
      resizable={false}
      showHeader={false}
      visible={props.isOpen}
      dismissableMask={true}
      className={props.className}
      onHide={props.onClose}
      onShow={props.onShow}
    >
      <div className="sb-dialog-header">
        <div className="sb-dialog-header-title">
          <If condition={props.headerIcon}>
            <Image src={props.headerIcon} width="45px" />
          </If>
          <Choose>
            <When condition={typeof props.headerTitle === 'string'}>
              <span>{props.headerTitle}</span>
            </When>
            <Otherwise>{props.headerTitle}</Otherwise>
          </Choose>
        </div>
        <div className="sb-dialog-header-close">
          <Button
            outlined
            icon="pi pi-times"
            size="large"
            onClick={props.onClose}
            aria-label="Close"
          />
        </div>
      </div>

      <div className="sb-dialog-content">{props.children}</div>
      <If condition={!props.hideButtons}>
        <div className="sb-dialog-footer w-full">
          <Button
            icon="pi pi-times"
            label={props.cancelLabel ?? 'Cancel'}
            outlined
            onClick={() => props.onCancel?.call(null)}
            className="w-8rem"
            aria-label="Cancel"
          />
          <Button
            icon="pi pi-check"
            label={props.submitLabel ?? 'Submit'}
            onClick={() => props.onSubmit?.call(null)}
            className="w-8rem"
            aria-label="Submit"
          />
        </div>
      </If>
    </Dialog>
  );
};

export default SBDialog;
