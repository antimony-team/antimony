import React from 'react';

import {Image} from 'primereact/image';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {useServerConfig} from '@sb/lib/stores/root-store';

import './credits-dialog.sass';

interface CreditsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Development versions also name the commit they were built from
function formatVersion() {
  const {SB_VERSION, SB_COMMIT} = import.meta.env;
  if (!SB_VERSION.endsWith('-dev')) return `v${SB_VERSION}`;

  return SB_COMMIT
    ? `v${SB_VERSION} (development version, ${SB_COMMIT})`
    : `v${SB_VERSION} (development version)`;
}

const CreditsDialog = (props: CreditsDialogProps) => {
  const serverConfig = useServerConfig();

  return (
    <SBDialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      headerTitle="Antimony"
      hideButtons={true}
      headerIcon="./antimony-logo.svg"
      className="sb-credits-dialog"
    >
      <div className="flex flex-row gap-2 align-items-end">
        <div className="flex flex-column justify-content-between">
          <div className="mb-4">
            A visual approach to designing and managing Containerlab networks.
          </div>
          <div className="flex flex-column gap-2">
            <div className="sb-credits-header">Version</div>
            <div className="mb-2">{formatVersion()}</div>
            <div className="sb-credits-header">Authors</div>
            <div className="mb-2">Kian Gribi, Tom Stromer</div>
            <div className="sb-credits-header">Deployment provider</div>
            <div className="mb-2">{serverConfig?.deployment?.provider}</div>
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
          src="./zoey.png"
          height="200px"
          alt="Zoey, the Antimony girl"
          title="Zoey, the Antimony girl"
        />
      </div>
    </SBDialog>
  );
};

export default CreditsDialog;
