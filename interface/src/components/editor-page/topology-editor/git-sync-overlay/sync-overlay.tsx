import {Topology} from '@sb/types/domain/topology';
import React, {useRef} from 'react';

import {observer} from 'mobx-react-lite';
import {OverlayPanel} from 'primereact/overlaypanel';

import './sync-overlay.sass';
import {Button} from 'primereact/button';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {fetchResource, isValidURL} from '@sb/lib/utils/utils';
import {useStatusMessages, useTopologyStore} from '@sb/lib/stores/root-store';

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
      if (topologyStore.manager.hasEdits()) {
        notificationStore.confirm({
          message: 'Discard unsaved changes?',
          header: 'Unsaved Changes',
          icon: 'pi pi-info-circle',
          severity: 'warning',
          onAccept: () => onSaveConfirm(content!),
        });
      } else {
        void onSaveConfirm(content!);
      }
    } else {
      urlFieldRef.current.setValidationError(validationError);
    }
  }

  async function onSave() {
    if (!urlFieldRef.current?.input.current || !props.topology) return;

    const value = urlFieldRef.current.input.current.value;
    if (value === props.topology?.syncUrl) {
      notificationStore.success('Sync URL has been udpated successfully.');
      return;
    }

    const [validationError] = await fetchSyncUrl(value);
    if (validationError === null) {
      const response = await topologyStore.update(props.topology?.id, {
        syncUrl: value,
      });

      if (response.isOk()) {
        notificationStore.success('Sync URL has been udpated successfully.');
      } else {
        notificationStore.error('Failed to update sync URL.');
      }
    } else {
      urlFieldRef.current.setValidationError(validationError);
    }
  }

  async function onSaveConfirm(content: string) {
    props.onSetContent(content);
  }

  async function fetchSyncUrl(
    value: string,
  ): Promise<[string | null, string | null]> {
    if (!isValidURL(value)) {
      return ['Specified URL is not valid', null];
    }

    const response = await fetchResource(value);

    if (!response?.ok) {
      return ['Unable to fetch from the provided resource.', null];
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text')) {
      return ['Unable to fetch from the provided resource.', null];
    } else {
      return [null, await response.text()];
    }
  }

  return (
    <OverlayPanel ref={props.popOverRef} className="sync-overlay-panel">
      <div className="flex flex-column gap-2">
        <SBInput
          id="sb-node-name"
          ref={urlFieldRef}
          label="Sync URL"
          defaultValue={props.topology?.syncUrl}
          onValueSubmit={onUrlSubmit}
        />
        <div className="flex flex-col justify-content-between">
          <Button
            icon="pi pi-save"
            className="sb-dock-page-button"
            label="Save"
            outlined
            onClick={onSave}
            aria-label="Save"
          />
          <Button
            icon="pi pi-sync"
            className="sb-dock-page-button"
            outlined
            onClick={onSync}
            label="Sync Now"
            aria-label="Sync Now"
          />
        </div>
      </div>
    </OverlayPanel>
  );
});

export default SyncOverlay;
