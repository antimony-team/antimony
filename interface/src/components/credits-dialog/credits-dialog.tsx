import React from 'react';

import {Image} from 'primereact/image';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './credits-dialog.sass';
import {useServerConfig} from '@sb/lib/stores/root-store';

interface CreditsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const CreditsDialog = (props: CreditsDialogProps) => {
  const serverConfig = useServerConfig();

  return (
    <SBDialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      headerTitle="Antimony"
      hideButtons={true}
      headerIcon="./icons/favicon-dark.png"
      className="sb-credits-dialog"
    >
      <div className="flex flex-row gap-2 align-items-end">
        <div className="flex flex-column justify-content-between">
          <div className="mb-4">
            A visual approach to designing and managing Containerlab networks.
          </div>
          <div>
            <div className="sb-credits-header">Version</div>
            <div className="mb-2">v1.0.0</div>
            <div className="sb-credits-header">Authors</div>
            <div className="mb-2">Kian Gribi, Tom Stromer</div>
            <div className="sb-credits-header">Deployment Provider</div>
            <div className="mb-2">{serverConfig.deployment.provider}</div>
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
          src="./icons/zoey-transparent.png"
          height="200px"
          title="Zoey, the Antimony girl"
        />
      </div>
    </SBDialog>
  );
};

export default CreditsDialog;
