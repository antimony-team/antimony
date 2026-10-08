import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';

import './editor-page.sass';
import {useCollectionStore, useTopologyStore} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {BindFile, EditingFile, Topology} from '@sb/types/domain/topology';

import {uuid4} from '@sb/types/types';

import {observer} from 'mobx-react-lite';
import React, {useCallback, useEffect, useState} from 'react';
import {useSearchParams} from 'react-router';
import TopologyEditor from './topology-editor/topology-editor';
import TopologyExplorer from './topology-explorer/topology-explorer';
import {
  Splitter,
  SplitterPanel,
  SplitterResizeEndEvent,
} from 'primereact/splitter';
import {Choose, Otherwise, When} from '@sb/types/control';
import EditorSetup from './editor-setup/editor-setup';
import CollectionEditDialog, {
  CollectionEditDialogState,
} from './collection-edit-dialog/collection-edit-dialog';
import TopologyEditDialog, {
  TopologyEditDialogState,
} from './topology-edit-dialog/topology-edit-dialog';
import ArchiveUploadDialog, {
  ArchiveUploadDialogState,
  ArchiveUploadFile,
} from './archive-upload-dialog/archive-upload-dialog';
import BindFileEditDialog, {
  BindFileEditDialogState,
} from './bind-file-edit-dialog/bind-file-edit-dialog';
import BindFileDirectoryEditDialog, {
  BindFileDirectoryEditDialogState,
} from './bind-file-edit-directory-dialog/bind-file-directory-edit-dialog';
import {isNumber, usePersistentState} from '@sb/lib/utils/persistent-state';

const EditorPage = observer(() => {
  const [isMaximized, setMaximized] = useState(false);
  const labEditDialogState = useDialogState<LabEditDialogState>(null);
  const [openFile, setOpenFile] = useState<EditingFile | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();

  const editCollectionState = useDialogState<CollectionEditDialogState>(null);
  const editTopologyState = useDialogState<TopologyEditDialogState>(null);
  const archiveUploadState = useDialogState<ArchiveUploadDialogState>(null);
  const editBindFileState = useDialogState<BindFileEditDialogState>(null);
  const editBindFileDirectoryState =
    useDialogState<BindFileDirectoryEditDialogState>(null);

  const [splitterPosition, setSplitterPosition] = usePersistentState<number>(
    'main-splitter',
    20,
    isNumber,
  );

  const onTopologyOpen = useCallback(
    (topology: Topology) => {
      setOpenFile(topology);
      setSearchParams({f: topology.id});
    },
    [setSearchParams],
  );

  const isSetup = topologyStore.data.length === 0;

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

  function onArchiveUploadConfirm(
    topology: Topology,
    files: ArchiveUploadFile[],
  ) {
    const bindFiles = files.map(file => {
      if (file.filePath.startsWith(`${topology.name}/`)) {
        file.filePath = file.filePath.substring(topology.name.length + 1);
      }
      return file;
    });

    void topologyStore.uploadArchiveFiles(topology.id, bindFiles);
  }

  function onOpenFile(id: string) {
    if (topologyStore.lookup.has(id)) {
      topologyStore.manager.openTopology(topologyStore.lookup.get(id)!);
    } else if (topologyStore.bindFileLookup.has(id)) {
      topologyStore.manager.openBindFile(topologyStore.bindFileLookup.get(id)!);
    }
  }

  return (
    <div className="sb-editor">
      <Choose>
        <When condition={isSetup}>
          <div className="sb-editor-setup-container sb-island">
            <EditorSetup
              collectionName="test"
              onCreateCollection={() =>
                editCollectionState.openWith({
                  editingCollection: null,
                  action: DialogAction.Add,
                })
              }
              onCreateTopology={() =>
                editTopologyState.openWith({
                  editingTopology: null,
                  collectionId: collectionStore.data[0].id,
                  action: DialogAction.Add,
                })
              }
            />
          </div>
        </When>
        <Otherwise>
          <Splitter
            onResizeEnd={(e: SplitterResizeEndEvent) =>
              setSplitterPosition(e.sizes[0])
            }
          >
            <SplitterPanel className="sb-island" size={splitterPosition}>
              <TopologyExplorer
                selectedId={openFile?.id}
                onOpenFile={onOpenFile}
                onTopologyDeploy={onDeployTopology}
                archiveUploadState={archiveUploadState}
                editBindFileState={editBindFileState}
                editTopologyState={editTopologyState}
                editBindFileDirectoryState={editBindFileDirectoryState}
                editCollectionState={editCollectionState}
              />
            </SplitterPanel>
            <SplitterPanel
              className="sb-island"
              minSize={40}
              size={100 - splitterPosition}
            >
              <TopologyEditor
                isMaximized={isMaximized}
                setMaximized={setMaximized}
                onTopologyDeploy={onDeployTopology}
              />
            </SplitterPanel>
          </Splitter>
        </Otherwise>
      </Choose>
      <LabEditDialog dialogState={labEditDialogState} />
      <TopologyEditDialog
        key={editTopologyState.state?.editingTopology?.id}
        dialogState={editTopologyState}
        onCreated={onOpenFile}
      />
      <CollectionEditDialog
        key={editCollectionState.state?.editingCollection?.id}
        dialogState={editCollectionState}
      />
      <BindFileEditDialog
        key={editBindFileState.state?.editingBindingFile?.id}
        dialogState={editBindFileState}
      />
      <BindFileDirectoryEditDialog
        key={editBindFileDirectoryState.state?.filePath}
        dialogState={editBindFileDirectoryState}
      />
      <ArchiveUploadDialog
        dialogState={archiveUploadState}
        onApply={onArchiveUploadConfirm}
      />
    </div>
  );
});

export default EditorPage;
