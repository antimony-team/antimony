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
import {toJS} from 'mobx';

const EditorPage = observer(() => {
  const [isMaximized, setMaximized] = useState(false);
  const labEditDialogState = useDialogState<LabEditDialogState>(null);
  const [openTopology, setOpenTopology] = useState<Topology | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  const onTopologyOpen = useCallback(
    (topology: Topology) => {
      setOpenTopology(topology);
      setSearchParams({t: topology.id});
    },
    [setSearchParams],
  );

  useEffect(() => {
    topologyStore.manager.onTopologyOpen.register(onTopologyOpen);

    return () =>
      topologyStore.manager.onTopologyOpen.unregister(onTopologyOpen);
  }, [topologyStore, onTopologyOpen]);

  useEffect(() => {
    if (
      searchParams.has('t') &&
      topologyStore.lookup.has(searchParams.get('t')!) &&
      topologyStore.manager.editingTopologyId !== searchParams.get('t')
    ) {
      topologyStore.manager.openTopology(
        topologyStore.lookup.get(searchParams.get('t')!)!,
      );
    }
  }, [searchParams, topologyStore.lookup]);

  function onDeployTopology(id: uuid4) {
    if (!topologyStore.lookup.has(id)) return;

    labEditDialogState.openWith({
      editingLab: null,
      topologyId: id,
      action: DialogAction.Add,
    });
  }

  function openFile(id: string) {
    if (topologyStore.manager.hasEdits()) {
      notificationStore.confirm({
        message: 'Discard unsaved changes?',
        header: 'Unsaved Changes',
        icon: 'pi pi-info-circle',
        severity: 'warning',
        onAccept: () => openFileConfirm(id),
      });
    } else {
      openFileConfirm(id);
    }
  }

  function openFileConfirm(id: string) {
    console.log('open file:', id);
    console.log('bind file lookup:', toJS(topologyStore.bindFileLookup));
    if (topologyStore.lookup.has(id)) {
      topologyStore.manager.openTopology(topologyStore.lookup.get(id)!);
    } else if (topologyStore.bindFileLookup.has(id)) {
      console.log('OPEN FILE CONFIGM');
      topologyStore.manager.openBindFile(topologyStore.bindFileLookup.get(id)!);
    }
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
          selectedTopologyId={openTopology?.id}
          onTopologySelect={openFile}
          onTopologyDeploy={onDeployTopology}
        />
      </div>
      <div
        className={classNames('sb-admin-page-right', {
          'sb-admin-page-right-maximized': isMaximized,
        })}
      >
        {/*<div className="font-bold height-100 sb-card overflow-y-auto overflow-x-hidden">*/}
        <TopologyEditor
          isMaximized={isMaximized}
          setMaximized={setMaximized}
          onTopologyDeploy={onDeployTopology}
        />
        {/*</div>*/}
      </div>
      <LabEditDialog dialogState={labEditDialogState} />
    </>
  );
});

export default EditorPage;
