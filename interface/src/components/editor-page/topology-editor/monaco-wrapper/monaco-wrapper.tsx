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

import {ValidationState} from '@sb/components/editor-page/topology-editor/topology-editor';
import {
  useAuthUser,
  useSchemaStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {
  BindFileEditReport,
  BindFileEditSource,
  TopologyEditReport,
  TopologyEditSource,
  TopologyManager,
} from '@sb/lib/topology-manager';
import {usePromiseWithResolvers} from '@sb/lib/utils/hooks';
import {If} from '@sb/types/control';
import {BindFile, Topology, TopologyFileType} from '@sb/types/domain/topology';

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
    const editorContainerRef = useRef<HTMLDivElement>(null);

    const authUser = useAuthUser();
    const schemaStore = useSchemaStore();
    const topologyStore = useTopologyStore();

    const editorReadyPromise = usePromiseWithResolvers();

    const onBindFileLinkClickRef = useRef(props.onBindFileLinkClick);
    onBindFileLinkClickRef.current = props.onBindFileLinkClick;

    const setContentRef = useRef(props.setContent);
    setContentRef.current = props.setContent;

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
        textModelRef.current.setValue(props.openTopology.definition.toString());
        annotationsModelRef.current.setValue(props.openTopology.annotations);
        viewStates.current.clear();
        currentlyOpenFileId.current = props.openTopology.id;
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
      if (
        !textModelRef.current ||
        editReport.source === TopologyEditSource.TextEditor
      ) {
        return;
      }

      const updatedContent = TopologyManager.serializeTopology(
        editReport.updatedTopology.definition,
      );
      const existingContent = textModelRef.current.getValue();

      const updatedContentStripped = updatedContent.replaceAll(' ', '');
      const existingContentStripped = existingContent.replaceAll(' ', '');

      isApplyingManagerContent.current = true;
      if (updatedContentStripped !== existingContentStripped) {
        setContent(updatedContent);
      }

      if (annotationsModelRef.current) {
        setContent(
          editReport.updatedTopology.annotations,
          annotationsModelRef.current,
        );
      }
      isApplyingManagerContent.current = false;
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
      setContent: setContent,
    }));

    // Replaces the content of a model as an edit, so it can be undone
    function setContent(
      content: string,
      model: ITextModel | null = textModelRef.current,
    ) {
      if (!model || model.getValue() === content) return;

      model.pushStackElement();
      model.pushEditOperations(
        [],
        [
          {
            range: model.getFullModelRange(),
            text: content,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );
      model.pushStackElement();
    }

    const onGlobalKeyPress = useCallback(
      (event: KeyboardEvent) => {
        if (!event.ctrlKey) return;

        switch (event.key) {
          case 's':
            props.onSaveFile();
            event.preventDefault();
            break;
          case 'z':
            onTriggerUndo();
            break;
          case 'y':
            onTriggerRedo();
            break;
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
      editorRef.current?.trigger('', 'undo', '');
    }

    function onTriggerRedo() {
      editorRef.current?.trigger('', 'redo', '');
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

      editorRef.current = monaco.editor.create(editorContainerRef.current, {
        model: textModelRef.current,
        language: 'text',
        theme: 'antimonyTheme',
        fontFamily: 'JetBrains Mono, monospace',
      });

      editorRef.current.updateOptions(MonacoOptions);

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
