import SyncOverlay from '@sb/components/editor-page/topology-editor/git-sync-overlay/sync-overlay';
import {OverlayPanel} from 'primereact/overlaypanel';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import FileSaver from 'file-saver';
import {Image} from 'primereact/image';
import {Badge} from 'primereact/badge';
import {Button} from 'primereact/button';
import {Splitter, SplitterPanel} from 'primereact/splitter';

import {uuid4} from '@sb/types/types';
import {TopologyEditReport, TopologyEditSource} from '@sb/lib/topology-manager';
import {
  useCollectionStore,
  useStatusMessages,
  useSchemaStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {useBeforeUnload} from 'react-router';
import {
  SimulationConfig,
  SimulationConfigContext,
} from './node-editor/state/simulation-config';
import NodeEditor from './node-editor/node-editor';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import NodeEditDialog from './node-edit-dialog/node-edit-dialog';
import MonacoWrapper, {MonacoWrapperRef} from './monaco-wrapper/monaco-wrapper';

import './topology-editor.sass';
import {Topology} from '@sb/types/domain/topology';
import {observer} from 'mobx-react-lite';

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

  const [isNodeEditDialogOpen, setNodeEditDialogOpen] = useState(false);
  const [openTopology, setOpenTopology] = useState<Topology | null>(null);
  const [currentlyEditedNode, setCurrentlyEditedNode] = useState<string | null>(
    null,
  );

  const collectionStore = useCollectionStore();
  const schemaStore = useSchemaStore();
  const topologyStore = useTopologyStore();
  const notificatioStore = useStatusMessages();

  const amogusAudio = useMemo(() => new Audio('/amogus.wav'), []);
  const monacoWrapperRef = useRef<MonacoWrapperRef>(null);

  const syncOverlayRef = useRef<OverlayPanel>(null);

  const onTopologyOpen = useCallback((topology: Topology) => {
    setOpenTopology(topology);
  }, []);

  const onTopologyClose = useCallback(() => {
    setOpenTopology(null);
  }, []);

  const onTopologyEdit = useCallback((editReport: TopologyEditReport) => {
    setPendingEdits(editReport.isEdited);
    setOpenTopology(editReport.updatedTopology);
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
    topologyStore.manager.onEdit.register(onTopologyEdit);
    topologyStore.manager.onOpen.register(onTopologyOpen);
    topologyStore.manager.onClose.register(onTopologyClose);

    return () => {
      topologyStore.manager.onEdit.unregister(onTopologyEdit);
      topologyStore.manager.onOpen.unregister(onTopologyOpen);
      topologyStore.manager.onClose.unregister(onTopologyClose);
    };
  }, [onTopologyOpen, onTopologyEdit, onTopologyClose]);

  function onContentChange(content: string) {
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

      const definition = topologyStore.parseTopologyDefinition(content);

      if (definition !== null) {
        setValidationState(ValidationState.Done);
        topologyStore.manager.apply(definition, TopologyEditSource.TextEditor);
      } else {
        // Set this to working until the monaco worker has finished and generated the error
        setValidationState(ValidationState.Working);
      }
    } catch (_) {
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

  async function onSaveTopology() {
    if (!hasPendingEdits) return;

    if (validationState !== ValidationState.Done) {
      notificatioStore.warning(
        'Your schema is not valid.',
        'Failed to save topology.',
      );
      return;
    }

    const result = await topologyStore.manager.save();
    if (result === null) {
      return;
    } else if (result.isErr()) {
      notificatioStore.error(result.error.message, 'Failed to save topology.');
    } else {
      notificatioStore.success('Topology has been saved!');
    }

    return;
  }

  function onDeployTopoplogy() {
    if (!openTopology) return;
    props.onTopologyDeploy(openTopology.id);
  }

  function onDownloadTopology() {
    if (!openTopology) return;

    const topologyGroup = collectionStore.lookup.get(
      openTopology.collectionId,
    )!;
    const blob = new Blob([openTopology.definition.toString()], {
      type: 'text/plain;charset=utf-8',
    });
    FileSaver.saveAs(
      blob,
      `${topologyGroup.name}_${openTopology.definition.get('name')}.yaml`,
    );
  }

  function onAmogus() {
    if (!amogusAudio.paused) return;
    amogusAudio.volume = 0.1;
    amogusAudio.play().catch(() => {});
  }

  if (!openTopology) {
    return (
      <div className="sb-topology-editor-empty" onDoubleClick={onAmogus}>
        <Image
          src="/icons/among-us.svg"
          width="350px"
          alt="Nothing selected placeholder"
        />
        <span className="text-center">No topology selected</span>
      </div>
    );
  }

  return (
    <>
      <div className="sb-topology-editor-container">
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
            <Button
              text
              icon="pi pi-sync"
              onClick={e => syncOverlayRef.current?.toggle(e)}
              tooltip="Sync Options"
              tooltipOptions={{position: 'bottom', showDelay: 500}}
              aria-label="Sync Options"
            />
            <Button
              text
              size="large"
              icon="pi pi-save"
              disabled={
                validationState !== ValidationState.Done || !hasPendingEdits
              }
              tooltip="Save"
              onClick={onSaveTopology}
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
              onClick={onDownloadTopology}
              tooltip="Download"
              tooltipOptions={{position: 'bottom', showDelay: 500}}
              aria-label="Download"
            />
          </div>
          <div className="flex gap-2 justify-content-center">
            <Button
              text
              icon="pi pi-play"
              severity="success"
              size="large"
              onClick={onDeployTopoplogy}
              tooltip="Deploy Topology"
              tooltipOptions={{
                position: 'bottom',
                showDelay: 500,
                showOnDisabled: true,
              }}
              aria-label="Deploy Topology"
            />
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
          <Splitter className="h-full">
            <SplitterPanel minSize={10} size={30}>
              <MonacoWrapper
                ref={monacoWrapperRef}
                validationError={validationError}
                validationState={validationState}
                language="yaml"
                setContent={onContentChange}
                onSaveTopology={onSaveTopology}
                setValidationError={onSetValidationError}
              />
            </SplitterPanel>
            <SplitterPanel minSize={10}>
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
