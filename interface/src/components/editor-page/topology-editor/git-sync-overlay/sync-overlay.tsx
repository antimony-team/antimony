import React, {useRef, useState} from 'react';

import {observer} from 'mobx-react-lite';
import {OverlayPanel} from 'primereact/overlaypanel';

import './sync-overlay.sass';
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
  function onSave() {}

  return (
    <OverlayPanel ref={props.popOverRef} className="sync-overlay-panel">
      <div className="flex flex-column gap-2">
        <SBInput
          id="sb-node-name"
          ref={urlFieldRef}
          label="Sync URL"
          // defaultValue={topologyStore.gitSourceUrl}
          onValueSubmit={onUrlSubmit}
        />
        <div className="flex flex-col justify-content-between">
          <Button
            icon="pi pi-save"
            className="sb-dock-page-button"
            label="Save"
            outlined
            onClick={onSave}
            disabled={!isUrlValid}
            aria-label="Save"
          />
          <Button
            icon="pi pi-sync"
            className="sb-dock-page-button"
            outlined
            onClick={onSync}
            disabled={!isUrlValid}
            aria-label="Sync Now"
          />
        </div>
      </div>
    </OverlayPanel>
  );
});

export default SyncOverlay;
