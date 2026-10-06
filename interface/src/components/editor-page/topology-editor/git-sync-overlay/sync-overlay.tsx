import {Topology} from '@sb/types/domain/topology';
import React, {useRef} from 'react';

import {observer} from 'mobx-react-lite';
import {OverlayPanel} from 'primereact/overlaypanel';

import './sync-overlay.sass';
import {Button} from 'primereact/button';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {useStatusMessages, useTopologyStore} from '@sb/lib/stores/root-store';
import {fetchSyncUrl} from '@sb/lib/utils/utils';

interface SyncOverlayProps {
  popOverRef: React.RefObject<OverlayPanel | null>;

  topology: Topology | null;
  onSetContent: (content: string) => void;
}

const SyncOverlay = observer((props: SyncOverlayProps) => {
  const urlFieldRef = useRef<SBInputRef>(null);

  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  function onUrlSubmit(_: string, implicit: boolean) {
    if (!implicit) void onSave();
  }

  async function onSync() {
    if (!urlFieldRef.current?.input.current || !props.topology) return;

    const value = urlFieldRef.current.input.current.value;
    const [validationError, content] = await fetchSyncUrl(value);
    if (validationError === null) {
      props.onSetContent(content!);
      props.popOverRef.current?.hide();
    } else {
      urlFieldRef.current.setValidationError(validationError);
    }
  }

  async function onSave() {
    if (!urlFieldRef.current?.input.current || !props.topology) return;

    const value = urlFieldRef.current.input.current.value;
    if (value === props.topology?.syncUrl) {
      notificationStore.success('Sync URL has been updated successfully.');
      return;
    }

    const [validationError] = await fetchSyncUrl(value);
    if (validationError === null) {
      const response = await topologyStore.update(props.topology?.id, {
        syncUrl: value,
      });

      if (response.isOk()) {
        notificationStore.success('Sync URL has been updated successfully.');
      } else {
        notificationStore.error('Failed to update sync URL.');
      }
    } else {
      urlFieldRef.current.setValidationError(validationError);
    }
  }

  return (
    <OverlayPanel ref={props.popOverRef} className="sync-overlay-panel">
      <div className="flex flex-column gap-2">
        <SBInput
          id="sync-url"
          ref={urlFieldRef}
          label="Sync URL"
          placeholder="e.g. https://example.com/topology.yaml"
          defaultValue={props.topology?.syncUrl}
          onValueSubmit={onUrlSubmit}
        />
        <div className="flex flex-col justify-content-between mt-1">
          <Button
            icon={
              <span className="material-symbols-outlined">
                vertical_align_bottom
              </span>
            }
            disabled={!props.topology?.syncUrl}
            className="sb-dock-page-button"
            outlined
            onClick={onSync}
            label="Fetch"
            aria-label="Fetch"
          />
          <Button
            icon="pi pi-save"
            className="sb-dock-page-button"
            label="Save"
            outlined
            onClick={onSave}
            aria-label="Save Sync URL"
          />
        </div>
      </div>
    </OverlayPanel>
  );
});

export default SyncOverlay;
