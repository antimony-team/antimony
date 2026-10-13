import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {toJS} from 'mobx';
import {observer} from 'mobx-react-lite';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import {configureMonacoYaml} from 'monaco-yaml';
import YamlWorker from 'monaco-yaml/yaml.worker?worker';

import {GraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {ValidationState} from '@sb/components/editor-page/topology-editor/topology-editor';
import {
  useAuthUser,
  useSchemaStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {TopologyHistory, TopologyHistoryEntry} from '@sb/lib/topology-history';
import {
  BindFileEditReport,
  BindFileEditSource,
  OpenFileType,
  TopologyEditReport,
  TopologyEditSource,
  TopologyManager,
} from '@sb/lib/topology-manager';
import {usePromiseWithResolvers} from '@sb/lib/utils/hooks';
import {If} from '@sb/types/control';
import {
  BindFile,
  Topology,
  TopologyAnnotations,
  TopologyDefinition,
  TopologyFileType,
} from '@sb/types/domain/topology';
import {YAMLDocument} from '@sb/types/types';

import {AntimonyTheme, MonacoOptions} from './monaco.conf';

import './monaco-wrapper.sass';
import ICodeEditor = monaco.editor.ICodeEditor;
import ITextModel = monaco.editor.ITextModel;
import ICodeEditorViewState = monaco.editor.ICodeEditorViewState;

const schemaModelUri = 'inmemory://schema.yaml';
const annotationsModelUri = 'inmemory://topology.clab.yaml.annotations.json';

window.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      case 'yaml':
        return new YamlWorker();
      default:
        return new EditorWorker();
    }
  },
};

interface MonacoWrapperProps {
  validationError: string | null;
  showValidation: boolean;
  validationState: ValidationState;

  onSaveFile: () => void;
  onBindFileLinkClick: (bindFileName: string) => void;

  setContent: (content: string, file: TopologyFileType) => void;
  setValidationError?: (error: string | null) => void;

  openTopology: Topology | null;
  openTopologyFile: TopologyFileType;
  openBindFile: BindFile | null;

  // Called when undo or redo restores a change in a file that isn't shown
  onOpenTopologyFile: (file: TopologyFileType) => void;

  // Undo history of the open topology, bind files use the history of monaco instead
  history: TopologyHistory;

  // Kept with changes of the graph, so undo and redo restore it
  graphSelection: GraphSelection;

  onLanguageChange: (language: string) => void;
  onCursorChange: (line: number, column: number) => void;
}

export interface MonacoWrapperRef {
  undo: () => void;
  redo: () => void;

  setContent: (content: string) => void;
}

const MonacoWrapper = observer(
  forwardRef<MonacoWrapperRef, MonacoWrapperProps>((props, ref) => {
    const [isReadOnly, setReadOnly] = useState(false);
    const [hasLastDeployFailed, setLastDeployFailed] = useState(false);

    // Holds the topology definition or the open bind file
    const textModelRef = useRef<ITextModel | null>(null);
    const annotationsModelRef = useRef<ITextModel | null>(null);
    const editorRef = useRef<ICodeEditor | null>(null);

    // The scroll and cursor positions of the models that are currently not shown
    const viewStates = useRef(new Map<ITextModel, ICodeEditorViewState>());

    const currentlyOpenFileId = useRef<string | null>(null);

    // Set while content from the topology manager is applied, which doesn't have to be reported back to it
    const isApplyingManagerContent = useRef(false);

    // The definition and annotations that are currently shown in the models
    // We store this so we don't always have to serialize and compare the string
    // representations of the definitions and annotations
    const currentDefinitionRef =
      useRef<YAMLDocument<TopologyDefinition> | null>(null);
    const currentAnnotationsRef = useRef<TopologyAnnotations | null>(null);

    // The history doesn't change, it's a ref so the callbacks that are only registered once can use it
    const history = useRef(props.history);

    // Set while an entry of the history is applied, which doesn't have to be recorded again
    const isApplyingHistory = useRef(false);

    // Set while content is changed by other means than typing
    const isReplacingContent = useRef(false);

    // Selections to restore once the file of an undone or redone change is shown
    const pendingSelections = useRef<monaco.ISelection[] | null>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);

    const authUser = useAuthUser();
    const schemaStore = useSchemaStore();
    const topologyStore = useTopologyStore();

    const editorReadyPromise = usePromiseWithResolvers();

    const onBindFileLinkClickRef = useRef(props.onBindFileLinkClick);
    onBindFileLinkClickRef.current = props.onBindFileLinkClick;

    const setContentRef = useRef(props.setContent);
    setContentRef.current = props.setContent;

    const openTopologyFileRef = useRef(props.openTopologyFile);
    openTopologyFileRef.current = props.openTopologyFile;

    const onOpenTopologyFileRef = useRef(props.onOpenTopologyFile);
    onOpenTopologyFileRef.current = props.onOpenTopologyFile;

    useEffect(() => {
      void onTopologyOpen();
    }, [props.openTopology]);

    useEffect(() => {
      void onBindFileOpen();
    }, [props.openBindFile]);

    useEffect(() => {
      void showOpenFile();
    }, [props.openTopologyFile, props.openTopology, props.openBindFile]);

    async function showOpenFile() {
      await editorReadyPromise.promise;

      const editor = editorRef.current;
      const model =
        props.openTopology &&
        props.openTopologyFile === TopologyFileType.Annotations
          ? annotationsModelRef.current
          : textModelRef.current;
      if (!editor || !model) return;

      const currentModel = editor.getModel();
      if (currentModel !== model) {
        const viewState = editor.saveViewState();
        if (currentModel && viewState) {
          viewStates.current.set(currentModel, viewState);
        }

        editor.setModel(model);
        editor.restoreViewState(viewStates.current.get(model) ?? null);
      }

      if (pendingSelections.current) {
        restoreSelections(pendingSelections.current);
        pendingSelections.current = null;
      }

      props.onLanguageChange(model.getLanguageId());

      const markers = monaco.editor.getModelMarkers({resource: model.uri});
      props.setValidationError?.(markers[0]?.message ?? null);
    }

    const onTopologyOpen = useCallback(async () => {
      if (!props.openTopology) return;
      await editorReadyPromise.promise;

      /*
       * Don't replace the current model if the topology ID has not changed.
       * This happens whenever a topology is saved and reloaded automatically.
       */
      if (currentlyOpenFileId.current === props.openTopology.id) {
        return;
      }

      setLastDeployFailed(props.openTopology.lastDeployFailed);
      setReadOnly(
        !authUser.isAdmin && authUser.id !== props.openTopology.creator.id,
      );

      if (textModelRef.current && annotationsModelRef.current) {
        monaco.editor.setModelLanguage(textModelRef.current, 'yaml');
        textModelRef.current.setValue(
          TopologyManager.serializeTopology(props.openTopology.definition),
        );
        annotationsModelRef.current.setValue(
          TopologyManager.serializeAnnotations(props.openTopology.annotations),
        );
        currentDefinitionRef.current = props.openTopology.definition;
        currentAnnotationsRef.current = props.openTopology.annotations;
        viewStates.current.clear();
        currentlyOpenFileId.current = props.openTopology.id;

        history.current.reset(historyEntry(TopologyFileType.Definition));
      }
    }, [props.openTopology]);

    const onBindFileOpen = useCallback(async () => {
      if (!props.openBindFile) return;
      await editorReadyPromise.promise;

      if (currentlyOpenFileId.current === props.openBindFile.id) {
        return;
      }

      const topology = topologyStore.lookup.get(props.openBindFile.topologyId);
      if (!topology) return;

      setLastDeployFailed(topology.lastDeployFailed);
      setReadOnly(!authUser.isAdmin && authUser.id !== topology.creator.id);

      if (textModelRef.current) {
        const languages = monaco.languages.getLanguages();
        const ext =
          '.' + props.openBindFile.filePath.split('.').pop()?.toLowerCase();

        const match = languages.find(lang => lang.extensions?.includes(ext));
        const language = match?.id ?? 'text';

        monaco.editor.setModelLanguage(textModelRef.current, language);
        textModelRef.current.setValue(props.openBindFile.content);
        viewStates.current.clear();
        currentlyOpenFileId.current = props.openBindFile.id;
      }
    }, [props.openBindFile]);

    const onTopologyEdit = useCallback((editReport: TopologyEditReport) => {
      if (editReport.source === TopologyEditSource.TextEditor) {
        return;
      }

      const {definition, annotations} = editReport.updatedTopology;
      let hasChanged = false;

      isApplyingManagerContent.current = true;
      if (textModelRef.current && definition !== currentDefinitionRef.current) {
        currentDefinitionRef.current = definition;

        const updatedContent = TopologyManager.serializeTopology(definition);
        const existingContent = textModelRef.current.getValue();

        if (updatedContent !== existingContent) {
          setContent(updatedContent);
          hasChanged = true;
        }
      }

      if (
        annotationsModelRef.current &&
        annotations !== currentAnnotationsRef.current
      ) {
        currentAnnotationsRef.current = annotations;

        const updatedAnnotations =
          TopologyManager.serializeAnnotations(annotations);
        const existingAnnotations = annotationsModelRef.current.getValue();

        if (updatedAnnotations !== existingAnnotations) {
          setContent(updatedAnnotations, annotationsModelRef.current);
          hasChanged = true;
        }
      }
      isApplyingManagerContent.current = false;

      // One entry for both files, so a change of the graph is undone in one step
      if (hasChanged) {
        history.current.record(
          {
            ...historyEntry(openTopologyFileRef.current),
            graphSelectionBefore: props.graphSelection.snapshot,
          },
          editReport.mergeKey ?? null,
        );
      }
    }, []);

    const onBindFileEdit = useCallback((editReport: BindFileEditReport) => {
      if (
        !textModelRef.current ||
        editReport.source === BindFileEditSource.TextEditor
      ) {
        return;
      }

      const existingContent = textModelRef.current.getValue();

      if (existingContent !== editReport.updatedBindFile.content) {
        setContent(editReport.updatedBindFile.content);
      }
    }, []);

    useEffect(() => {
      topologyStore.manager.onTopologyEdit.register(onTopologyEdit);
      topologyStore.manager.onBindFileEdit.register(onBindFileEdit);

      return () => {
        topologyStore.manager.onTopologyEdit.unregister(onTopologyEdit);
        topologyStore.manager.onBindFileEdit.unregister(onBindFileEdit);
      };
    }, []);

    useEffect(() => {
      editorRef.current?.updateOptions({readOnly: isReadOnly});
    }, [isReadOnly]);

    useImperativeHandle(ref, () => ({
      undo: onTriggerUndo,
      redo: onTriggerRedo,
      setContent: (content: string) => {
        isReplacingContent.current = true;
        setContent(content);
        isReplacingContent.current = false;
      },
    }));

    /**
     * Replaces the content of a model as an edit, so it can be undone. Only the
     * changed part is replaced, so the cursor stays where it is.
     */
    function setContent(
      content: string,
      model: ITextModel | null = textModelRef.current,
    ) {
      if (!model) return;

      const existingContent = model.getValue();
      if (existingContent === content) return;

      const maxLength = Math.min(existingContent.length, content.length);

      let start = 0;
      while (start < maxLength && existingContent[start] === content[start]) {
        start++;
      }

      let end = 0;
      while (
        end < maxLength - start &&
        existingContent[existingContent.length - 1 - end] ===
          content[content.length - 1 - end]
      ) {
        end++;
      }

      model.pushStackElement();
      model.pushEditOperations(
        [],
        [
          {
            range: monaco.Range.fromPositions(
              model.getPositionAt(start),
              model.getPositionAt(existingContent.length - end),
            ),
            text: content.slice(start, content.length - end),
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );
      model.pushStackElement();
    }

    /**
     * Returns the current content of both topology files as history entry.
     */
    function historyEntry(file: TopologyFileType): TopologyHistoryEntry {
      const model = getTopologyModel(file);

      return {
        definition: textModelRef.current?.getValue() ?? '',
        annotations: annotationsModelRef.current?.getValue() ?? '',
        file,
        selections:
          model && editorRef.current?.getModel() === model
            ? editorRef.current.getSelections()
            : null,
      };
    }

    function getTopologyModel(file: TopologyFileType) {
      return file === TopologyFileType.Annotations
        ? annotationsModelRef.current
        : textModelRef.current;
    }

    function applyHistoryEntry(
      entry: TopologyHistoryEntry,
      file: TopologyFileType,
    ) {
      isApplyingHistory.current = true;
      setContent(entry.definition, textModelRef.current);
      setContent(entry.annotations, annotationsModelRef.current);
      isApplyingHistory.current = false;

      const selections = entry.file === file ? entry.selections : null;

      if (file !== openTopologyFileRef.current) {
        // The selections are restored once the file is shown
        pendingSelections.current = selections;
        onOpenTopologyFileRef.current(file);
      } else if (selections) {
        restoreSelections(selections);
      }
    }

    function restoreSelections(selections: monaco.ISelection[]) {
      const editor = editorRef.current;
      if (!editor || selections.length === 0) return;

      editor.setSelections(selections);
      editor.revealRangeInCenterIfOutsideViewport(
        monaco.Selection.liftSelection(selections[0]),
      );
    }

    function isEditorReadOnly() {
      return (
        editorRef.current?.getOption(monaco.editor.EditorOption.readOnly) ??
        true
      );
    }

    const onGlobalKeyPress = useCallback(
      (event: KeyboardEvent) => {
        if (!event.ctrlKey) return;

        if (event.key === 's') {
          props.onSaveFile();
          event.preventDefault();
          return;
        }

        // The editor handles undo and redo with its own commands, and inputs keep their own undo
        const target = event.target as HTMLElement | null;
        if (
          editorContainerRef.current?.contains(target) ||
          target?.closest('input, textarea, [contenteditable="true"]')
        ) {
          return;
        }

        // Browsers have their own shortcuts on these keys, e.g. reopening a closed tab
        if (event.key === 'z') {
          event.preventDefault();
          onTriggerUndo();
        } else if (event.key === 'y' || event.key === 'Z') {
          event.preventDefault();
          onTriggerRedo();
        }
      },
      [props],
    );

    useEffect(() => {
      window.addEventListener('keydown', onGlobalKeyPress);

      return () => {
        window.removeEventListener('keydown', onGlobalKeyPress);
      };
    }, [onGlobalKeyPress]);

    function onTriggerUndo() {
      if (topologyStore.manager.currentFileType !== OpenFileType.Topology) {
        editorRef.current?.trigger('', 'undo', '');
        return;
      }

      if (isEditorReadOnly()) return;

      const undone = history.current.undo(props.graphSelection.snapshot);
      if (!undone) return;

      props.graphSelection.setPendingSelection(undone.graphSelection ?? null);
      applyHistoryEntry(undone.entry, undone.file);
    }

    function onTriggerRedo() {
      if (topologyStore.manager.currentFileType !== OpenFileType.Topology) {
        editorRef.current?.trigger('', 'redo', '');
        return;
      }

      if (isEditorReadOnly()) return;

      const redone = history.current.redo();
      if (!redone) return;

      props.graphSelection.setPendingSelection(redone.graphSelection ?? null);
      applyHistoryEntry(redone.entry, redone.file);
    }

    function initializeEditor() {
      if (!editorContainerRef.current || !schemaStore.clabSchema) {
        console.error('Failed to initialize monaco editor');
        return () => {};
      }

      // if (props.language === 'yaml') {
      const yamlPlugin = configureMonacoYaml(monaco, {
        enableSchemaRequest: false,
        schemas: [
          {
            fileMatch: ['**/*.yaml'],
            schema: toJS(schemaStore.clabSchema),
            uri: import.meta.env.SB_CLAB_SCHEMA_URL!,
          },
        ],
      });

      const bindFileLinkProvider = monaco.languages.registerLinkProvider(
        {pattern: '**/*'},
        {
          provideLinks(model) {
            const links = [];
            const pathRegex = /(?<=-\s)[\w./\\-]+(?=:)/g;

            // Find all binds sections in the topology
            const bindsMatches = model.findMatches(
              '^\\s*binds:\\s*$',
              false,
              true,
              false,
              null,
              false,
            );

            for (const {range} of bindsMatches) {
              let lineNum = range.startLineNumber + 1;

              while (lineNum <= model.getLineCount()) {
                const line = model.getLineContent(lineNum);
                if (!/^\s*-\s/.test(line)) break;

                let match;
                pathRegex.lastIndex = 0;
                while ((match = pathRegex.exec(line)) !== null) {
                  links.push({
                    range: new monaco.Range(
                      lineNum,
                      match.index + 1,
                      lineNum,
                      match.index + match[0].length + 1,
                    ),
                    tooltip: `Open ${match[0]}`,
                  });
                }
                lineNum++;
              }
            }

            return {links};
          },

          resolveLink(link) {
            if (textModelRef.current) {
              onBindFileLinkClickRef.current!(
                textModelRef.current.getValueInRange(link.range),
              );
            }
            return link;
          },
        },
      );

      if (schemaStore.annotationsSchema) {
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          validate: true,
          enableSchemaRequest: false,
          schemas: [
            {
              uri: 'inmemory://clab-annotations.schema.json',
              fileMatch: [annotationsModelUri],
              schema: toJS(schemaStore.annotationsSchema),
            },
          ],
        });
      }

      const markerCallback = monaco.editor.onDidChangeMarkers(() => {
        const model = editorRef.current?.getModel();
        if (!model) return;

        const markers = monaco.editor.getModelMarkers({resource: model.uri});
        if (markers.length > 0 && props.setValidationError) {
          props.setValidationError(markers[0].message);
        }
      });
      // }

      monaco.editor.defineTheme('antimonyTheme', AntimonyTheme);

      textModelRef.current = monaco.editor.createModel(
        '',
        'text',
        monaco.Uri.parse(schemaModelUri),
      );

      annotationsModelRef.current = monaco.editor.createModel(
        '',
        'json',
        monaco.Uri.parse(annotationsModelUri),
      );

      const editor = monaco.editor.create(editorContainerRef.current, {
        model: textModelRef.current,
        language: 'text',
        theme: 'antimonyTheme',
        fontFamily: 'JetBrains Mono Variable, monospace',
      });
      editorRef.current = editor;

      editor.updateOptions(MonacoOptions);

      // Topology files are undone with the topology history instead of the history of monaco
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ,
        onTriggerUndo,
      );
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
        onTriggerRedo,
      );
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        onTriggerRedo,
      );

      const textModel = textModelRef.current;
      const annotationsModel = annotationsModelRef.current;
      const textModelListener = textModel.onDidChangeContent(() =>
        onContentChange(textModel, TopologyFileType.Definition),
      );
      const annotationsModelListener = annotationsModel.onDidChangeContent(() =>
        onContentChange(annotationsModel, TopologyFileType.Annotations),
      );

      const cursorListener = editorRef.current.onDidChangeCursorPosition(e => {
        props.onCursorChange?.(e.position.lineNumber, e.position.column);
      });

      return () => {
        cursorListener.dispose();
        textModelListener.dispose();
        annotationsModelListener.dispose();
        editorRef.current?.dispose();
        textModelRef.current?.dispose();
        annotationsModelRef.current?.dispose();
        yamlPlugin.dispose();
        bindFileLinkProvider.dispose();
        markerCallback.dispose();
      };
    }

    useEffect(() => {
      if (!editorContainerRef.current) return;

      const editorDisposable = initializeEditor();

      const resizeObserver = new ResizeObserver(entries => {
        const {width, height} = entries[0].contentRect;
        requestAnimationFrame(() => editorRef.current?.layout({width, height}));
      });
      resizeObserver.observe(editorContainerRef.current);

      editorReadyPromise.resolve();

      return () => {
        editorDisposable();

        textModelRef.current = null;
        annotationsModelRef.current = null;
        editorRef.current = null;
        resizeObserver.disconnect();
      };
    }, []);

    function onContentChange(model: ITextModel, file: TopologyFileType) {
      if (isApplyingManagerContent.current) return;

      if (
        !isApplyingHistory.current &&
        topologyStore.manager.currentFileType === OpenFileType.Topology
      ) {
        history.current.record(
          historyEntry(file),
          isReplacingContent.current ? null : `typing-${file}`,
        );
      }

      setContentRef.current(model.getValue(), file);
    }

    return (
      <>
        <div className="h-full flex flex-column">
          <If condition={isReadOnly}>
            <div className="sb-monaco-wrapper-readonly">
              <span>The current file is opened in read-only mode.</span>
            </div>
          </If>
          <If condition={hasLastDeployFailed}>
            <div className="sb-monaco-wrapper-unsuccessful">
              <span>
                The last deployment of this topology was unsuccessful.
              </span>
            </div>
          </If>
          <div className="sb-monaco-wrapper">
            <div ref={editorContainerRef} style={{height: '100%'}}></div>
          </div>
        </div>
      </>
    );
  }),
);

export default MonacoWrapper;
