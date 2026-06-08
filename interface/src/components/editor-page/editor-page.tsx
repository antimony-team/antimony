import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';

import './editor-page.sass';
import {useStatusMessages, useTopologyStore} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {BindFile, EditingFile, Topology} from '@sb/types/domain/topology';

import {uuid4} from '@sb/types/types';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import React, {useCallback, useEffect, useState} from 'react';
import {useSearchParams} from 'react-router';
import TopologyEditor from './topology-editor/topology-editor';
import TopologyExplorer from './topology-explorer/topology-explorer';

const EditorPage = observer(() => {
  const [isMaximized, setMaximized] = useState(false);
  const labEditDialogState = useDialogState<LabEditDialogState>(null);
  const [openFile, setOpenFile] = useState<EditingFile | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  const onTopologyOpen = useCallback(
    (topology: Topology) => {
      setOpenFile(topology);
      setSearchParams({f: topology.id});
    },
    [setSearchParams],
  );

  const onBindFileOpen = useCallback(
    (bindFile: BindFile) => {
      setOpenFile(bindFile);
      setSearchParams({f: bindFile.id});
    },
    [setSearchParams],
  );

  useEffect(() => {
    topologyStore.manager.onTopologyOpen.register(onTopologyOpen);
    topologyStore.manager.onBindFileOpen.register(onBindFileOpen);

    return () => {
      topologyStore.manager.onTopologyOpen.unregister(onTopologyOpen);
      topologyStore.manager.onBindFileOpen.unregister(onBindFileOpen);
    };
  }, [topologyStore, onTopologyOpen, onBindFileOpen]);

  useEffect(() => {
    if (!searchParams.has('f')) return;

    const fileId = searchParams.get('f')!;

    if (topologyStore.lookup.has(fileId)) {
      topologyStore.manager.openTopology(topologyStore.lookup.get(fileId)!);
    } else if (topologyStore.bindFileLookup.has(fileId)) {
      topologyStore.manager.openBindFile(
        topologyStore.bindFileLookup.get(fileId)!,
      );
    }
  }, [searchParams, topologyStore.lookup]);

  function onDeployTopology(topologyId: uuid4) {
    if (!topologyStore.lookup.has(topologyId)) return;

    labEditDialogState.openWith({
      editingLab: null,
      topologyId: topologyId,
      action: DialogAction.Add,
    });
  }

  function onOpenFile(id: string) {
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
    if (topologyStore.lookup.has(id)) {
      topologyStore.manager.openTopology(topologyStore.lookup.get(id)!);
    } else if (topologyStore.bindFileLookup.has(id)) {
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
          selectedId={openFile?.id}
          onFileSelect={onOpenFile}
          onTopologyDeploy={onDeployTopology}
        />
      </div>
      <div
        className={classNames('sb-admin-page-right', {
          'sb-admin-page-right-maximized': isMaximized,
        })}
      >
        <TopologyEditor
          isMaximized={isMaximized}
          setMaximized={setMaximized}
          onTopologyDeploy={onDeployTopology}
        />
      </div>
      <LabEditDialog dialogState={labEditDialogState} />
    </>
  );
});

export default EditorPage;
