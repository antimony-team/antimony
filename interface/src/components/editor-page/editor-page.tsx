import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';

import './editor-page.sass';
import {useStatusMessages, useTopologyStore} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {Topology} from '@sb/types/domain/topology';

import {uuid4} from '@sb/types/types';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import React, {useCallback, useEffect, useState} from 'react';
import {useSearchParams} from 'react-router';
import TopologyEditor from './topology-editor/topology-editor';
import TopologyExplorer from './topology-explorer/topology-explorer';

const EditorPage: React.FC = observer(() => {
  const [isMaximized, setMaximized] = useState(false);
  const labEditDialogState = useDialogState<LabEditDialogState>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  const onTopologyOpen = useCallback(
    (topology: Topology) => {
      setSearchParams({t: topology.id});
    },
    [setSearchParams],
  );

  useEffect(() => {
    topologyStore.manager.onOpen.register(onTopologyOpen);

    return () => topologyStore.manager.onOpen.unregister(onTopologyOpen);
  }, [topologyStore, onTopologyOpen]);

  useEffect(() => {
    if (
      searchParams.has('t') &&
      topologyStore.lookup.has(searchParams.get('t')!) &&
      topologyStore.manager.editingTopologyId !== searchParams.get('t')
    ) {
      topologyStore.manager.open(
        topologyStore.lookup.get(searchParams.get('t')!)!,
      );
    }
  }, [searchParams, topologyStore.lookup]);

  function onSelectTopology(id: string) {
    if (!topologyStore.lookup.has(id)) return;

    if (topologyStore.manager.hasEdits()) {
      notificationStore.confirm({
        message: 'Discard unsaved changes?',
        header: 'Unsaved Changes',
        icon: 'pi pi-info-circle',
        severity: 'warning',
        onAccept: () => onSelectConfirm(id),
      });
    } else {
      onSelectConfirm(id);
    }
  }

  function onDeployTopology(id: uuid4) {
    if (!topologyStore.lookup.has(id)) return;

    labEditDialogState.openWith({
      editingLab: null,
      topologyId: id,
      action: DialogAction.Add,
    });
  }

  function onSelectConfirm(id: string) {
    if (!topologyStore.lookup.has(id)) return;

    topologyStore.manager.open(topologyStore.lookup.get(id)!);
  }

  return (
    <>
      <div
        className={classNames(
          'font-bold',
          'height-100',
          'sb-card',
          'overflow-y-auto',
          'overflow-x-hidden',
          'sb-admin-page-left',
          {
            'sb-admin-page-left-maximized': isMaximized,
          },
        )}
      >
        <TopologyExplorer
          selectedTopologyId={searchParams.get('t')}
          onTopologySelect={onSelectTopology}
          onTopologyDeploy={onDeployTopology}
        />
      </div>
      <div
        className={classNames('flex-grow-1', 'sb-admin-page-right', {
          'sb-admin-page-right-maximized': isMaximized,
        })}
      >
        <div className="font-bold height-100 sb-card overflow-y-auto overflow-x-hidden">
          <TopologyEditor
            isMaximized={isMaximized}
            setMaximized={setMaximized}
            onTopologyDeploy={onDeployTopology}
          />
        </div>
      </div>
      <LabEditDialog dialogState={labEditDialogState} />
    </>
  );
});

export default EditorPage;
