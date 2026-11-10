import React, {useCallback, useMemo, useRef, useState} from 'react';

import FileSaver from 'file-saver';
import {observer} from 'mobx-react-lite';

import {Badge} from 'primereact/badge';
import {Button} from 'primereact/button';
import {OverlayPanel} from 'primereact/overlaypanel';
import {
  Splitter,
  SplitterPanel,
  SplitterResizeEndEvent,
} from 'primereact/splitter';
import {Tooltip} from 'primereact/tooltip';

import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';
import {TopologyEditDialogState} from '@sb/components/editor-page/topology-edit-dialog/topology-edit-dialog';
import SyncOverlay from '@sb/components/editor-page/topology-editor/git-sync-overlay/sync-overlay';
import NodeEditor from '@sb/components/editor-page/topology-editor/node-editor/node-editor';
import {
  EditorDocument,
  EditorView,
} from '@sb/lib/editor/document/editor-document';
import {
  useEditorTabStore,
  useSchemaStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {isNumber, usePersistentState} from '@sb/lib/utils/persistent-state';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {FetchState, Position, uuid4} from '@sb/types/types';

import EditorViewSwitch, {
  isValidEditorView,
} from './editor-view-switch/editor-view-switch';
import MonacoWrapper, {MonacoWrapperRef} from './monaco-wrapper/monaco-wrapper';
import NodeEditDialog from './node-edit-dialog/node-edit-dialog';
import {
  GraphSelection,
  GraphSelectionContext,
} from './node-editor/state/graph-selection';
import TopologyFileSwitch from './topology-file-switch/topology-file-switch';
import TopologyFooterStats from './topology-footer-stats/topology-footer-stats';

import './topology-editor.sass';

export enum ValidationState {
  Working,
  Done,
  Error,
}

interface TopologyEditorProps {
  // The document of the open tab, null if no tab is open
  document: EditorDocument | null;

  isMaximized: boolean;
  setMaximized: (isMinimized: boolean) => void;

  onTopologyDeploy: (id: uuid4) => void;

  editTopologyState: DialogState<TopologyEditDialogState>;
}

const TopologyEditor = observer((props: TopologyEditorProps) => {
  const [currentLanguage, setCurrentLanguage] = useState<string>();
  const [currentCursorPosition, setCurrentCursorPosition] = useState<{
    x: number;
    y: number;
  }>({x: 0, y: 0});

  // The first problem the text editor found in the shown file
  const [validationError, setValidationError] = useState<string | null>(null);

  const [isNodeEditDialogOpen, setNodeEditDialogOpen] = useState(false);
  const [currentlyEditedNode, setCurrentlyEditedNode] = useState<string | null>(
    null,
  );
  const [newNodePosition, setNewNodePosition] = useState<Position | null>(null);

  const schemaStore = useSchemaStore();
  const topologyStore = useTopologyStore();
  const tabStore = useEditorTabStore();
  const notificationStore = useStatusMessages();

  const [view, setView] = usePersistentState<EditorView>(
    'editor-view',
    'split',
    isValidEditorView,
  );

  const [splitterPosition, setSplitterPosition] = usePersistentState<number>(
    'editor-splitter',
    30,
    isNumber,
  );

  const monacoWrapperRef = useRef<MonacoWrapperRef>(null);
  const [graphSelection] = useState(() => new GraphSelection());

  const syncOverlayRef = useRef<OverlayPanel>(null);

  const document = props.document;
  const activeFile = document?.activeFile ?? null;
  const graph = document?.graph ?? null;
  const capabilities = document?.capabilities ?? null;
  const hasPendingEdits = document?.isEdited ?? false;

  // The problems of the text editor only count for files it validates
  const validationState: ValidationState = !document
    ? ValidationState.Done
    : document.isParsing
      ? ValidationState.Working
      : !document.isValid || (activeFile?.validation && validationError)
        ? ValidationState.Error
        : ValidationState.Done;

  const views = capabilities?.views ?? ['code'];
  const effectiveView: EditorView = views.includes(view) ? view : views[0];

  const pageTitle = useMemo(() => {
    if (!document) return 'Antimony | Editor';

    return `Antimony | ${document.title}${hasPendingEdits ? '*' : ''}`;
  }, [document, document?.title, hasPendingEdits]);

  function onEditNode(nodeName: string) {
    setCurrentlyEditedNode(nodeName);
    setNodeEditDialogOpen(true);
  }

  function onAddNode(position: Position) {
    setCurrentlyEditedNode(null);
    setNewNodePosition(position);
    setNodeEditDialogOpen(true);
  }

  async function onSaveFile() {
    if (!document?.isEdited) return;

    if (!document.isValid) {
      notificationStore.error(
        'Your topology is not valid.',
        'Failed to save topology.',
      );
      return;
    }

    const result = await document.save();
    if (result.isErr()) {
      notificationStore.error(result.error.message, 'Failed to save file.');
    }
  }

  function onDeployTopoplogy() {
    if (!document?.topologyId) return;

    props.onTopologyDeploy(document.topologyId);
  }

  function onDownload() {
    if (!activeFile?.buffer) return;

    const blob = new Blob([activeFile.buffer.text], {
      type: 'text/plain;charset=utf-8',
    });
    FileSaver.saveAs(blob, activeFile.downloadName);
  }

  const onFileLinkClick = useCallback(
    (filePath: string) => {
      if (!document?.topologyId) return;

      const topology = topologyStore.lookup.get(document.topologyId);
      const bindFile = topology?.bindFiles.find(
        file => file.filePath === filePath,
      );

      if (bindFile) {
        tabStore.open(bindFile.id);
      } else {
        askToCreateBindFile(document.topologyId, filePath);
      }
    },
    [document],
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
      tabStore.open(result.data.payload);
    }
  }

  function onAddTopology() {
    props.editTopologyState.openWith({
      topology: null,
      collectionId: null,
      action: DialogAction.Add,
    });
  }

  if (!document || !activeFile) {
    return (
      <div className="sb-topology-editor-empty">
        <SBEmptyState
          title="No topology open"
          text="Pick a topology from the left sidebar."
          icon={<span className="material-symbols-outlined">network_node</span>}
          children={
            <Button
              icon="pi pi-plus"
              label="New topology"
              className="sb-button-accent"
              onClick={onAddTopology}
            />
          }
        />
      </div>
    );
  }

  return (
    <>
      <title>{pageTitle}</title>
      <div className="sb-topology-editor-container">
        <div className="sb-topology-editor-toolbar">
          <div className="sb-topology-editor-toolbar-left">
            <ol
              className="sb-topology-editor-toolbar-crumbs"
              aria-label="Breadcrumb"
            >
              <li>
                <span className="sb-topology-editor-toolbar-subtitle">
                  <span
                    className="material-symbols-outlined"
                    aria-hidden="true"
                  >
                    {graph ? 'inventory_2' : 'network_node'}
                  </span>
                  {document.subtitle}
                </span>
              </li>
              <li>
                <div className="sb-topology-editor-toolbar-title">
                  <span
                    className="material-symbols-outlined"
                    aria-hidden="true"
                  >
                    {document.icon}
                  </span>
                  {`${document.title}${hasPendingEdits ? '*' : ''}`}
                </div>
              </li>
              <If condition={document.files.length > 1}>
                <li>
                  <TopologyFileSwitch
                    files={document.files}
                    value={activeFile.id}
                    onChange={fileId => document.selectFile(fileId)}
                  />
                </li>
              </If>
            </ol>
            <EditorViewSwitch
              value={effectiveView}
              onChange={setView}
              disabledViews={(['code', 'split', 'graph'] as const).filter(
                option => !views.includes(option),
              )}
            />
          </div>
          <div className="sb-topology-editor-toolbar-right">
            <Button
              text
              icon={<span className="material-symbols-outlined">undo</span>}
              onClick={() => monacoWrapperRef.current?.undo()}
              disabled={!document.history.canUndo}
              aria-label="Undo"
            />
            <Button
              text
              icon={<span className="material-symbols-outlined">redo</span>}
              onClick={() => monacoWrapperRef.current?.redo()}
              disabled={!document.history.canRedo}
              aria-label="Redo"
            />
            <span className="sb-editor-toolbar-separator" />
            {capabilities!.sync && (
              <Button
                text
                icon="pi pi-sync"
                onClick={e => syncOverlayRef.current?.toggle(e)}
                tooltip="Sync options"
                tooltipOptions={{position: 'bottom', showDelay: 500}}
                aria-label="Sync options"
              />
            )}
            <Button
              text
              size="large"
              icon="pi pi-save"
              disabled={
                validationState !== ValidationState.Done || !hasPendingEdits
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
            <If condition={capabilities!.deploy}>
              <span className="sb-editor-toolbar-separator" />
              <Button
                outlined
                className="sb-topology-editor-deploy-button"
                icon="pi pi-play"
                label="Deploy"
                onClick={onDeployTopoplogy}
                aria-label="Deploy topology"
              />
            </If>
          </div>
        </div>

        <If condition={document.hasConflict}>
          <div className="sb-topology-editor-conflict" role="alert">
            <span className="material-symbols-outlined" aria-hidden="true">
              warning
            </span>
            <span>
              This file was changed somewhere else since you started editing it.
            </span>
            <Button
              text
              size="small"
              label="Keep my changes"
              onClick={() => document.keepChanges()}
            />
            <Button
              text
              size="small"
              label="Load the saved version"
              onClick={() => document.revert()}
            />
          </div>
        </If>

        <div className={`sb-topology-editor-content view-${effectiveView}`}>
          <Splitter
            onResizeEnd={(e: SplitterResizeEndEvent) =>
              setSplitterPosition(e.sizes[0])
            }
          >
            <SplitterPanel className="sb-editor-monaco" size={splitterPosition}>
              <If condition={schemaStore.fetchReport.state === FetchState.Done}>
                <MonacoWrapper
                  ref={monacoWrapperRef}
                  document={document}
                  onSaveFile={onSaveFile}
                  graphSelection={graphSelection}
                  setValidationError={setValidationError}
                  onFileLinkClick={onFileLinkClick}
                  onLanguageChange={setCurrentLanguage}
                  onCursorChange={(row, col) =>
                    setCurrentCursorPosition({x: row, y: col})
                  }
                />
              </If>
            </SplitterPanel>
            <SplitterPanel
              className="sb-editor-graph"
              size={100 - splitterPosition}
            >
              <If condition={graph}>
                <GraphSelectionContext.Provider value={graphSelection}>
                  {/*
                   * One graph per document: elements with the same ID in another topology, e.g. a
                   * node of the same name, would otherwise keep their position and cached labels
                   */}
                  <NodeEditor
                    key={document.id}
                    onAddNode={onAddNode}
                    onEditNode={onEditNode}
                    graph={graph!}
                    openTopology={graph!.topology}
                  />
                </GraphSelectionContext.Provider>
              </If>
            </SplitterPanel>
          </Splitter>
        </div>
        <div className="sb-topology-editor-footer">
          <div
            className="sb-monaco-wrapper-error"
            data-validation-state={ValidationState[
              validationState
            ]?.toLowerCase()}
            data-pr-tooltip={validationError ?? 'Schema valid'}
            data-pr-position="right"
            // Keyboard users get the tooltip on focus, screen readers the error in the name
            role="note"
            tabIndex={0}
            aria-label={
              validationState === ValidationState.Error
                ? `Error: ${validationError ?? 'invalid'}`
                : validationState === ValidationState.Working
                  ? 'Pending'
                  : 'Valid'
            }
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
          </div>
          <span>{currentLanguage}</span>
          <div className="sb-topology-editor-footer-position">
            {`Ln ${currentCursorPosition.x}, Col ${currentCursorPosition.y}`}
          </div>
          <TopologyFooterStats
            topology={graph?.topology ?? null}
            graphSelection={graphSelection}
          />
        </div>
      </div>

      <Tooltip
        className="sb-monaco-wrapper-error-tooltip"
        target=".sb-monaco-wrapper-error"
        event="both"
      />
      <SyncOverlay
        popOverRef={syncOverlayRef}
        topology={
          document.topologyId
            ? (topologyStore.lookup.get(document.topologyId) ?? null)
            : null
        }
        onSetContent={content =>
          document.replaceText(document.files[0].id, content)
        }
      />
      <NodeEditDialog
        key={currentlyEditedNode}
        isOpen={isNodeEditDialogOpen}
        // Only read while the dialog is open, otherwise every edit renders the whole editor again
        graph={graph}
        editingTopology={
          isNodeEditDialogOpen ? (graph?.topology?.definition ?? null) : null
        }
        editingAnnotations={
          isNodeEditDialogOpen ? (graph?.topology?.annotations ?? null) : null
        }
        editingNode={currentlyEditedNode}
        newNodePosition={newNodePosition}
        onClose={() => setNodeEditDialogOpen(false)}
      />
    </>
  );
});

export default TopologyEditor;
