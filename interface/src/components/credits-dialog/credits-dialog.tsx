import React from 'react';

import {Image} from 'primereact/image';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './credits-dialog.sass';

interface CreditsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const CreditsDialog = (props: CreditsDialogProps) => {
  return (
    <SBDialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      headerTitle="Antimony"
      hideButtons={true}
      headerIcon="/icons/favicon-dark.png"
      className="sb-credits-dialog"
    >
      <div className="flex flex-row gap-2">
        <div className="flex flex-column justify-content-between">
          <div className="mb-4">
            Antimony is a 2025 student project of the&nbsp;
            <a href="https://www.ost.ch/" target="_blank">
              University of Applied Sciences Rapperswil (OST)
            </a>
            .
          </div>
          <div>
            <div className="sb-credits-header">Version</div>
            <div className="mb-2">v0.0.1</div>
            <div className="sb-credits-header">Authors</div>
            <div className="mb-2">Kian Gribi, Tom Stromer</div>
            <div className="sb-credits-header">Provided by</div>
            <div className="mb-2">
              <a
                href="https://www.ost.ch/en/research-and-consulting-services/computer-science/ins-institute-for-network-and-security"
                target="_blank"
              >
                Institute for Networking and Security
              </a>
            </div>
          </div>
        </div>
        <Image
          src="/icons/zoey-bg.png"
          width="140px"
          title="Zoey, the Antimony girl"
        />
      </div>
    </SBDialog>
  );
};

export default CreditsDialog;
