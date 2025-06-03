import React, {useRef, useState} from 'react';

import {observer} from 'mobx-react-lite';
import {OverlayPanel} from 'primereact/overlaypanel';

import './git-sync-overlay.sass';
import {Button} from 'primereact/button';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {isValidURL} from '@sb/lib/utils/utils';
import {useTopologyStore} from '@sb/lib/stores/root-store';

interface SyncOverlayProps {
  popOverRef: React.RefObject<OverlayPanel>;
}

const SyncOverlay = observer((props: SyncOverlayProps) => {
  const [isUrlValid, setUrlValid] = useState(false);
  const urlFieldRef = useRef<SBInputRef>(null);

  const topologyStore = useTopologyStore();

  async function onUrlSubmit(value: string): string {
    if (!isValidURL(value)) {
      return 'Specified URL is not valid';
    }
    const response = await fetch(value);
    if (!response.ok) {
      return 'Unable to fetch from the provided resource.';
    }
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text')) {
      setUrlValid(true);
      topologyStore.manager.updateSyncUrl(value);
      void topologyStore.manager.save();
    }
    return '';
  }

  function onSync() {}

  return (
    <OverlayPanel ref={props.popOverRef} className="filter-overlay-panel">
      <div className="filters-container">
        <SBInput
          id="sb-node-name"
          ref={urlFieldRef}
          label="Name"
          defaultValue={topologyStore.gitSourceUrl}
          onValueSubmit={onUrlSubmit}
        />
        <Button
          icon="pi pi-sync"
          className="sb-dock-page-button"
          label="Sync with Repo"
          outlined
          onClick={onSync}
          disabled={!isUrlValid}
          aria-label="Topology Editor Page"
        />
      </div>
    </OverlayPanel>
  );
});

export default SyncOverlay;
