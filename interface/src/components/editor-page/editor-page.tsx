import React, {useEffect, useState} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {useSearchParams} from 'react-router';

import {
  Splitter,
  SplitterPanel,
  SplitterResizeEndEvent,
} from 'primereact/splitter';

import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import {
  useAuthUser,
  useEditorTabStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {isNumber, usePersistentState} from '@sb/lib/utils/persistent-state';
import {Choose, Otherwise, When} from '@sb/types/control';
import {Topology} from '@sb/types/domain/topology';
import {FetchState, uuid4} from '@sb/types/types';

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
import CollectionEditDialog, {
  CollectionEditDialogState,
} from './collection-edit-dialog/collection-edit-dialog';
import EditorSetup from './editor-setup/editor-setup';
import EditorStartPane from './editor-start-pane/editor-start-pane';
import EditorTabs from './editor-tabs/editor-tabs';
import TopologyEditDialog, {
  TopologyEditDialogState,
} from './topology-edit-dialog/topology-edit-dialog';
import TopologyEditor from './topology-editor/topology-editor';
import TopologyExplorer from './topology-explorer/topology-explorer';

import './editor-page.sass';

const EditorPage = observer(() => {
  const [isMaximized, setMaximized] = useState(false);
  const labEditDialogState = useDialogState<LabEditDialogState>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const topologyStore = useTopologyStore();
  const tabStore = useEditorTabStore();
  const authUser = useAuthUser();

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

  const isLoaded = topologyStore.fetchReport.state === FetchState.Done;
  const activeId = tabStore.activeId;
  const missingId = tabStore.missingId;

  // The tabs of the last visit are restored once the topologies are loaded
  useEffect(() => {
    if (isLoaded && authUser.id) tabStore.load(authUser.id);
  }, [isLoaded, authUser.id]);

  // A link to a file opens it, and the URL names the file of the shown tab
  useEffect(() => {
    if (!isLoaded || !authUser.id) return;

    const fileId = searchParams.get('f');
    if (
      fileId &&
      fileId !== tabStore.activeId &&
      fileId !== tabStore.missingId
    ) {
      tabStore.open(fileId);
    }
  }, [searchParams, isLoaded, authUser.id]);

  // Reads the shown tab when it runs: the effect above may have just opened the file of the URL.
  // A file that wasn't found stays in the URL, so the link can be checked.
  useEffect(() => {
    if (!isLoaded) return;

    const shownId = tabStore.missingId ?? tabStore.activeId;
    if ((searchParams.get('f') ?? null) === shownId) return;

    setSearchParams(shownId ? {f: shownId} : {}, {replace: true});
  }, [activeId, missingId, isLoaded]);

  // Unsaved changes are kept in the browser, also when the page is left right after a change
  useEffect(() => {
    const flush = () => tabStore.flushDrafts();
    window.addEventListener('pagehide', flush);

    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const isSetup = topologyStore.data.length === 0;

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
    const topologyName = topology.definition.name ?? '';
    const bindFiles = files.map(file => {
      if (file.filePath.startsWith(`${topologyName}/`)) {
        file.filePath = file.filePath.substring(topologyName.length + 1);
      }
      return file;
    });

    void topologyStore.uploadArchiveFiles(topology.id, bindFiles);
  }

  function onAddTopology() {
    editTopologyState.openWith({
      topology: null,
      collectionId: null,
      action: DialogAction.Add,
    });
  }

  function onOpenFile(id: string, preview = false) {
    tabStore.open(id, preview);
  }

  return (
    <div className="sb-editor">
      <Choose>
        <When condition={isSetup}>
          <div className="sb-editor-setup-container sb-island">
            <EditorSetup
              onCreateCollection={() =>
                editCollectionState.openWith({
                  editingCollection: null,
                  action: DialogAction.Add,
                })
              }
              onCreateTopology={collectionId =>
                editTopologyState.openWith({
                  topology: null,
                  collectionId: collectionId,
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
                selectedId={activeId}
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
              className="sb-editor-panel"
              minSize={40}
              size={100 - splitterPosition}
            >
              <EditorTabs />
              <div
                className={classNames('sb-island sb-editor-island', {
                  'first-tab-active':
                    !missingId &&
                    !!activeId &&
                    tabStore.documents[0]?.id === activeId,
                })}
              >
                <Choose>
                  <When condition={missingId !== null || !tabStore.active}>
                    <EditorStartPane onAddTopology={onAddTopology} />
                  </When>
                  <Otherwise>
                    <TopologyEditor
                      document={tabStore.active}
                      isMaximized={isMaximized}
                      setMaximized={setMaximized}
                      onTopologyDeploy={onDeployTopology}
                      editTopologyState={editTopologyState}
                    />
                  </Otherwise>
                </Choose>
              </div>
            </SplitterPanel>
          </Splitter>
        </Otherwise>
      </Choose>
      <LabEditDialog dialogState={labEditDialogState} />
      <TopologyEditDialog
        key={editTopologyState.state?.topology?.id}
        dialogState={editTopologyState}
        onCreated={id => onOpenFile(id)}
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
