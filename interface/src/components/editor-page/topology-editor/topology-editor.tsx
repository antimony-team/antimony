import SyncOverlay from '@sb/components/editor-page/topology-editor/git-sync-overlay/sync-overlay';
import {OverlayPanel} from 'primereact/overlaypanel';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import FileSaver from 'file-saver';
import {Badge} from 'primereact/badge';
import {Button} from 'primereact/button';

import {uuid4} from '@sb/types/types';
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

  const amogusAudio = useMemo(() => new Audio('/amogus.wav'), []);
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

  useEffect(() => {
    if (hasPendingEdits || validationState !== ValidationState.Done) {
      document.title = 'Antimony*';
    } else {
      document.title = 'Antimony';
    }
  }, [hasPendingEdits, validationState]);

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
    } /* else {
      notificationStore.success('File has been saved!');
    }*/
  }

  function onDeployTopoplogy() {
    if (!openTopology) return;

    props.onTopologyDeploy(openTopology.id);
  }

  function onDownload() {
    if (openTopology) {
      const topologyGroup = collectionStore.lookup.get(
        openTopology.collectionId,
      )!;
      const blob = new Blob([openTopology.definition.toString()], {
        type: 'text/yaml;charset=utf-8',
      });
      FileSaver.saveAs(
        blob,
        `${topologyGroup.name}_${openTopology.definition.get('name')}.yaml`,
      );
    } else if (openBindFile) {
      const topology = topologyStore.lookup.get(openBindFile.id);
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
      <div
        className="sb-topology-editor-container"
        style={{
          opacity: openTopology || openBindFile ? '1' : '0',
        }}
      >
        <div className="sb-topology-editor-toolbar">
          <div className="flex gap-2 justify-content-center left-tab">
            <Button
              text
              icon="pi pi-undo"
              tooltip="Undo"
              onClick={() => monacoWrapperRef.current?.undo()}
              tooltipOptions={{position: 'bottom', showDelay: 500}}
              aria-label="Undo"
            />
            <Button
              text
              icon="pi pi-refresh"
              tooltip="Redo"
              onClick={() => monacoWrapperRef.current?.redo()}
              tooltipOptions={{position: 'bottom', showDelay: 500}}
              aria-label="Redo"
            />
          </div>
          <div className="flex gap-2">
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
          </div>
          <div className="flex gap-2 justify-content-center">
            <If condition={openTopology}>
              <Button
                text
                icon="pi pi-play"
                severity="success"
                size="large"
                onClick={onDeployTopoplogy}
                aria-label="Deploy Topology"
              />
            </If>
            <Choose>
              <When condition={props.isMaximized}>
                <Button
                  text
                  icon="pi pi-arrow-down-left-and-arrow-up-right-to-center"
                  size="large"
                  onClick={() => props.setMaximized(false)}
                  aria-label="Maximize"
                />
              </When>
              <Otherwise>
                <Button
                  text
                  icon="pi pi-arrow-up-right-and-arrow-down-left-from-center"
                  size="large"
                  onClick={() => props.setMaximized(true)}
                  aria-label="Minimize"
                />
              </Otherwise>
            </Choose>
          </div>
        </div>
        <div className="sb-topology-editor-content">
          <Splitter
            className="h-full"
            pt={{
              gutter: {
                style: {opacity: openTopology ? '1' : '0'},
                className: 'sb-topology-editor-splitter-gutter',
              },
            }}
          >
            <SplitterPanel size={50}>
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
              />
            </SplitterPanel>
            <SplitterPanel
              size={50}
              className="sb-topology-editor-node-editor-panel"
              style={{
                opacity: openTopology ? '1' : '0',
              }}
            >
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
