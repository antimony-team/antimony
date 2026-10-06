import SyncOverlay from '@sb/components/editor-page/topology-editor/git-sync-overlay/sync-overlay';
import {OverlayPanel} from 'primereact/overlaypanel';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import FileSaver from 'file-saver';
import {Button} from 'primereact/button';

import {FetchState, uuid4} from '@sb/types/types';
import {
  BindFileEditReport,
  BindFileEditSource,
  OpenFileType,
  TopologyEditReport,
  TopologyEditSource,
} from '@sb/lib/topology-manager';
import {
  useCollectionStore,
  useSchemaStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {useBeforeUnload} from 'react-router';

import {Choose, If, Otherwise, When} from '@sb/types/control';
import NodeEditDialog from './node-edit-dialog/node-edit-dialog';
import MonacoWrapper, {MonacoWrapperRef} from './monaco-wrapper/monaco-wrapper';

import './topology-editor.sass';
import {BindFile, Topology} from '@sb/types/domain/topology';
import {observer} from 'mobx-react-lite';
import {Splitter, SplitterPanel} from 'primereact/splitter';
import {
  SimulationConfig,
  SimulationConfigContext,
} from './node-editor/state/simulation-config';
import NodeEditor from '@sb/components/editor-page/topology-editor/node-editor/node-editor';
import EditorViewSwitch, {
  EditorView,
  isValidEditorView,
} from './editor-view-switch/editor-view-switch';
import {Badge} from 'primereact/badge';
import {Tooltip} from 'primereact/tooltip';
import {pluralize} from '@sb/lib/utils/utils';
import {usePersistentState} from '@sb/lib/utils/hooks';

export enum ValidationState {
  Working,
  Done,
  Error,
}

interface TopologyEditorProps {
  isMaximized: boolean;
  setMaximized: (isMinimized: boolean) => void;

  onTopologyDeploy: (id: uuid4) => void;
}

const TopologyEditor = observer((props: TopologyEditorProps) => {
  // const [, setValidationError] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState<string>();
  const [currentCursorPosition, setCurrentCursorPosition] = useState<{
    x: number;
    y: number;
  }>({x: 0, y: 0});

  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationState, setValidationState] = useState<ValidationState>(
    ValidationState.Done,
  );

  // Set to true if topology has pending changes and validation succeeded
  const [hasPendingEdits, setPendingEdits] = useState(false);

  const [validationEnabled, setValidationEnabled] = useState(true);

  const [isNodeEditDialogOpen, setNodeEditDialogOpen] = useState(false);
  const [openTopology, setOpenTopology] = useState<Topology | null>(null);
  const [openBindFile, setOpenBindFile] = useState<BindFile | null>(null);
  const [currentlyEditedNode, setCurrentlyEditedNode] = useState<string | null>(
    null,
  );

  const collectionStore = useCollectionStore();
  const schemaStore = useSchemaStore();
  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  const [view, setView] = usePersistentState<EditorView>(
    'editor-view',
    'split',
    isValidEditorView,
  );

  // const amogusAudio = useMemo(() => new Audio('/amogus.wav'), []);
  const monacoWrapperRef = useRef<MonacoWrapperRef>(null);

  const syncOverlayRef = useRef<OverlayPanel>(null);

  const onTopologyOpen = useCallback((topology: Topology) => {
    setOpenTopology(topology);
    setOpenBindFile(null);
    setValidationEnabled(true);
  }, []);

  const onTopologyEdit = useCallback((editReport: TopologyEditReport) => {
    setPendingEdits(editReport.isEdited);
    setOpenTopology(editReport.updatedTopology);
  }, []);

  const onBindFileOpen = useCallback((bindFile: BindFile) => {
    setOpenBindFile(bindFile);
    setOpenTopology(null);
    setValidationEnabled(false);
  }, []);

  const onBindFileEdit = useCallback((editReport: BindFileEditReport) => {
    setPendingEdits(editReport.isEdited);
    setOpenBindFile(editReport.updatedBindFile);
  }, []);

  const onFileClose = useCallback(() => {
    setOpenTopology(null);
    setOpenBindFile(null);
    setPendingEdits(false);
  }, []);

  useEffect(() => {
    if (!openTopology) return;

    if (!topologyStore.lookup.has(openTopology.id)) {
      topologyStore.manager.close();
    }
  }, [topologyStore.lookup]);

  const pageTitle = useMemo(() => {
    if (!openTopology && !openBindFile) {
      return 'Antimony | Editor';
    }

    let tabTitle = 'Antimony';
    if (openTopology?.name) {
      tabTitle += ` | ${openTopology.name}`;
    } else if (openBindFile?.filePath) {
      tabTitle += ` | ${openBindFile.filePath}`;
    }

    if (hasPendingEdits) {
      tabTitle += '*';
    }

    return tabTitle;
  }, [hasPendingEdits, openTopology, openBindFile]);

  useBeforeUnload(ev => {
    if (hasPendingEdits || validationState !== ValidationState.Done) {
      ev.preventDefault();
    }
  });

  useEffect(() => {
    topologyStore.manager.onTopologyEdit.register(onTopologyEdit);
    topologyStore.manager.onTopologyOpen.register(onTopologyOpen);

    topologyStore.manager.onBindFileEdit.register(onBindFileEdit);
    topologyStore.manager.onBindFileOpen.register(onBindFileOpen);

    topologyStore.manager.onClose.register(onFileClose);

    return () => {
      topologyStore.manager.onTopologyEdit.unregister(onTopologyEdit);
      topologyStore.manager.onTopologyOpen.unregister(onTopologyOpen);

      topologyStore.manager.onBindFileEdit.unregister(onBindFileEdit);
      topologyStore.manager.onBindFileOpen.unregister(onBindFileOpen);

      topologyStore.manager.onClose.unregister(onFileClose);
    };
  }, [
    onTopologyOpen,
    onTopologyEdit,
    onFileClose,
    onBindFileOpen,
    onBindFileEdit,
  ]);

  const effectiveView: EditorView = openBindFile ? 'code' : view;

  const topologyCollection = useMemo(() => {
    if (!openTopology) return null;

    return collectionStore.lookup.get(openTopology.collectionId)!;
  }, [collectionStore.data, openTopology]);

  const validateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onContentChange(content: string) {
    if (topologyStore.manager.currentFileType === OpenFileType.Topology) {
      updateTopologyContent(content);
    } else if (
      topologyStore.manager.currentFileType === OpenFileType.BindFile
    ) {
      topologyStore.manager.editBindFile(
        content,
        BindFileEditSource.TextEditor,
      );
    }
  }

  function updateTopologyContent(content: string) {
    if (!schemaStore.clabSchema) return;

    try {
      /*
       * If the topology is empty, instantly return an error as it's not allowed to be empty.
       * We need to have this special case because the monaco YAML validator won't classify
       * an empty file as invalid.
       */
      if (!content) {
        setValidationState(ValidationState.Error);
        return;
      }

      setValidationState(ValidationState.Working);

      if (validateTimeoutRef.current) {
        clearTimeout(validateTimeoutRef.current);
      }

      validateTimeoutRef.current = setTimeout(() => {
        const definition = topologyStore.parseTopologyDefinition(content);

        if (definition !== null) {
          setValidationState(ValidationState.Done);
          topologyStore.manager.editTopology(
            definition,
            TopologyEditSource.TextEditor,
          );
        }

        // We don't explicitly set the validation state to error here,
        // but let the monaco-yaml validator find the error and handle it.
      }, 100);
    } catch {
      setValidationState(ValidationState.Working);
    }
  }

  function onSetValidationError(error: string | null) {
    if (!error) {
      setValidationState(ValidationState.Done);
      return;
    }

    setValidationState(ValidationState.Error);
    setValidationError(error);
  }

  function onEditNode(nodeName: string) {
    setCurrentlyEditedNode(nodeName);
    setNodeEditDialogOpen(true);
  }

  function onAddNode() {
    setCurrentlyEditedNode(null);
    setNodeEditDialogOpen(true);
  }

  async function onSaveFile() {
    if (!hasPendingEdits) return;

    if (validationEnabled && validationState !== ValidationState.Done) {
      notificationStore.error(
        'Your topology is not valid.',
        'Failed to save topology.',
      );
      return;
    }

    const result = await topologyStore.manager.save();
    if (result === null) {
      return;
    } else if (result.isErr()) {
      notificationStore.error(result.error.message, 'Failed to save file.');
    }
  }

  function onDeployTopoplogy() {
    if (!openTopology) return;

    props.onTopologyDeploy(openTopology.id);
  }

  function onDownload() {
    if (openTopology) {
      const blob = new Blob([openTopology.definition.toString()], {
        type: 'text/yaml;charset=utf-8',
      });
      FileSaver.saveAs(
        blob,
        `${topologyCollection!.name}_${openTopology.definition.get('name')}.yaml`,
      );
    } else if (openBindFile) {
      const topology = topologyStore.bindFileLookup.get(openBindFile.id);
      if (!topology) return;

      const blob = new Blob([openBindFile.content], {
        type: 'text/plain;charset=utf-8',
      });

      const bindFileNameParts = openBindFile.filePath.split('/');
      const bindFileName = bindFileNameParts[bindFileNameParts.length - 1];

      FileSaver.saveAs(blob, bindFileName);
    }
  }

  const onBindFileLinkClick = useCallback(
    (bindFilePath: string) => {
      if (!openTopology) return;

      const bindFile = openTopology.bindFiles.find(
        file => file.filePath === bindFilePath,
      );

      if (topologyStore.manager.hasEdits()) {
        notificationStore.confirm({
          message: 'Discard unsaved changes?',
          header: 'Unsaved Changes',
          icon: 'pi pi-info-circle',
          severity: 'warning',
          onAccept: () => {
            if (bindFile) {
              topologyStore.manager.openBindFile(bindFile);
            } else {
              askToCreateBindFile(openTopology.id, bindFilePath);
            }
          },
        });
      } else {
        if (bindFile) {
          topologyStore.manager.openBindFile(bindFile);
        } else {
          askToCreateBindFile(openTopology.id, bindFilePath);
        }
      }
    },
    [openTopology],
  );

  function askToCreateBindFile(topologyId: string, bindFilePath: string) {
    notificationStore.confirm({
      message: 'Do you want to create this file?',
      header: 'File does not exist',
      icon: 'pi pi-info-circle',
      severity: 'info',
      onAccept: () => createBindFile(topologyId, bindFilePath),
    });
  }

  async function createBindFile(topologyId: string, bindFilePath: string) {
    const result = await topologyStore.addBindFile(topologyId, {
      filePath: bindFilePath,
      content: '',
    });

    if (result.isErr()) {
      notificationStore.error(
        result.error.message,
        'Failed to create bind file',
      );
    } else {
      notificationStore.success('Bind file has been created successfully.');
      const bindFile = topologyStore.bindFileLookup.get(result.data.payload);
      topologyStore.manager.openBindFile(bindFile!);
    }
  }

  return (
    <>
      <title>{pageTitle}</title>
      <div
        className="sb-topology-editor-container"
        style={{
          opacity: openTopology || openBindFile ? '1' : '0',
        }}
      >
        <div className="sb-topology-editor-toolbar">
          <div className="sb-topology-editor-toolbar-left">
            <span className="sb-topology-editor-toolbar-subtitle">
              {topologyCollection?.name} /
            </span>
            <span className="sb-topology-editor-toolbar-title">
              {`${openTopology?.name}${topologyStore.manager.hasEdits() ? '*' : ''}`}
            </span>
            <span className="sb-editor-toolbar-separator" />
            <Button
              text
              icon={<span className="material-symbols-outlined">undo</span>}
              onClick={() => monacoWrapperRef.current?.undo()}
              aria-label="Undo"
            />
            <Button
              text
              icon={<span className="material-symbols-outlined">redo</span>}
              onClick={() => monacoWrapperRef.current?.redo()}
              aria-label="Redo"
            />
          </div>
          <EditorViewSwitch
            value={effectiveView}
            onChange={setView}
            disabledViews={openBindFile ? ['split', 'graph'] : []}
          />
          <div className="sb-topology-editor-toolbar-right">
            {openTopology && (
              <Button
                text
                icon="pi pi-sync"
                onClick={e => syncOverlayRef.current?.toggle(e)}
                tooltip="Sync Options"
                tooltipOptions={{position: 'bottom', showDelay: 500}}
                aria-label="Sync Options"
              />
            )}
            <Button
              text
              size="large"
              icon="pi pi-save"
              disabled={
                (validationEnabled &&
                  validationState !== ValidationState.Done) ||
                !hasPendingEdits
              }
              tooltip="Save"
              onClick={onSaveFile}
              tooltipOptions={{position: 'bottom', showDelay: 500}}
              pt={{
                icon: {
                  className: 'p-overlay-badge',
                  children: (
                    <If condition={hasPendingEdits}>
                      <Badge severity="danger" />
                    </If>
                  ),
                },
              }}
              aria-label="Save"
            />
            <Button
              text
              icon="pi pi-download"
              size="large"
              onClick={onDownload}
              tooltip="Download"
              tooltipOptions={{position: 'bottom', showDelay: 500}}
              aria-label="Download"
            />
            <If condition={openTopology}>
              <span className="sb-editor-toolbar-separator" />
              <Button
                outlined
                className="sb-topology-editor-deploy-button"
                icon="pi pi-play"
                label="Deploy"
                onClick={onDeployTopoplogy}
                aria-label="Deploy Topology"
              />
            </If>
          </div>
        </div>
        <div className={`sb-topology-editor-content view-${effectiveView}`}>
          <Splitter>
            <SplitterPanel className="sb-editor-monaco" size={50}>
              <If condition={schemaStore.fetchReport.state === FetchState.Done}>
                <MonacoWrapper
                  ref={monacoWrapperRef}
                  showValidation={validationEnabled}
                  validationError={''}
                  validationState={validationState}
                  setContent={onContentChange}
                  onSaveFile={onSaveFile}
                  openTopology={openTopology}
                  openBindFile={openBindFile}
                  setValidationError={onSetValidationError}
                  onBindFileLinkClick={onBindFileLinkClick}
                  onLanguageChange={setCurrentLanguage}
                  onCursorChange={(row, col) =>
                    setCurrentCursorPosition({x: row, y: col})
                  }
                />
              </If>
            </SplitterPanel>
            <SplitterPanel size={50} className="sb-editor-graph">
              <SimulationConfigContext.Provider value={new SimulationConfig()}>
                <NodeEditor
                  onAddNode={onAddNode}
                  onEditNode={onEditNode}
                  openTopology={openTopology!}
                />
              </SimulationConfigContext.Provider>
            </SplitterPanel>
          </Splitter>
        </div>
        <div className="sb-topology-editor-footer">
          <div
            className="sb-monaco-wrapper-error"
            data-testid="validation-status"
            data-validation-state={ValidationState[
              validationState
            ]?.toLowerCase()}
            data-pr-tooltip={validationError ?? 'Schema Valid'}
            data-pr-position="right"
          >
            <Choose>
              <When condition={validationState === ValidationState.Error}>
                <i
                  className="pi pi-times"
                  style={{color: 'var(--danger-color-text)'}}
                />
                <span>Error</span>
              </When>
              <When condition={validationState === ValidationState.Working}>
                <i
                  className="pi pi-spinner pi-spin"
                  style={{color: 'var(--warning-color-text)'}}
                />
                <span>Pending</span>
              </When>
              <Otherwise>
                <i
                  className="pi pi-check"
                  style={{color: 'var(--success-color-text)'}}
                />
                <span>Valid</span>
              </Otherwise>
            </Choose>
            <Tooltip
              className="sb-monaco-wrapper-error-tooltip"
              target=".sb-monaco-wrapper-error"
            />
          </div>
          <span>{currentLanguage}</span>
          <div className="sb-topology-editor-footer-position">
            {`Ln ${currentCursorPosition.x}, Col ${currentCursorPosition.y}`}
          </div>
          <If condition={openTopology}>
            <div className="sb-dot-separated">
              <div>{pluralize(openTopology!.nodeCount, 'node', 'nodes')}</div>
              <div>
                {pluralize(openTopology!.connections.length, 'link', 'links')}
              </div>
            </div>
          </If>
        </div>
      </div>
      <SyncOverlay
        popOverRef={syncOverlayRef}
        topology={openTopology}
        onSetContent={content => monacoWrapperRef.current?.setContent(content)}
      />
      <NodeEditDialog
        key={currentlyEditedNode}
        isOpen={isNodeEditDialogOpen}
        editingTopology={openTopology?.definition ?? null}
        editingNode={currentlyEditedNode}
        onClose={() => setNodeEditDialogOpen(false)}
      />
    </>
  );
});

export default TopologyEditor;
