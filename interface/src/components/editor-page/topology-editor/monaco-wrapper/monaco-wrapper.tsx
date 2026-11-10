import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import {reaction, toJS} from 'mobx';
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
import {
  DocumentFile,
  EditorDocument,
  RestoredChange,
} from '@sb/lib/editor/document/editor-document';
import {
  FileBuffer,
  FileChange,
  FileEditSource,
} from '@sb/lib/editor/file-buffer';
import {
  useEditorTabStore,
  useSchemaStore,
  useTheme,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {usePromiseWithResolvers} from '@sb/lib/utils/hooks';
import {If} from '@sb/types/control';

import {
  AntimonyLightTheme,
  AntimonyTheme,
  MonacoOptions,
  monacoTheme,
} from './monaco.conf';

import './monaco-wrapper.sass';
import ICodeEditor = monaco.editor.ICodeEditor;
import ITextModel = monaco.editor.ITextModel;
import ICodeEditorViewState = monaco.editor.ICodeEditorViewState;

// The ends of the model URIs the schemas of the text editor apply to
const CONTAINERLAB_SUFFIX = '.clab.yaml';
const ANNOTATIONS_SUFFIX = '.annotations.json';

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
  // The document of the open tab, its active file is shown
  document: EditorDocument | null;

  onSaveFile: () => void;
  onFileLinkClick: (filePath: string) => void;

  setValidationError?: (error: string | null) => void;

  // Kept with changes of the graph, so undo and redo restore it
  graphSelection: GraphSelection;

  onLanguageChange: (language: string) => void;
  onCursorChange: (line: number, column: number) => void;
}

export interface MonacoWrapperRef {
  undo: () => void;
  redo: () => void;
}

// The model of a file and what keeps it in sync with the buffer of the file
interface FileModel {
  model: ITextModel;
  file: DocumentFile;
  document: EditorDocument;
  dispose: () => void;
}

const MonacoWrapper = observer(
  forwardRef<MonacoWrapperRef, MonacoWrapperProps>((props, ref) => {
    const themeStore = useTheme();
    const schemaStore = useSchemaStore();
    const topologyStore = useTopologyStore();
    const tabStore = useEditorTabStore();

    const editorRef = useRef<ICodeEditor | null>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const editorReadyPromise = usePromiseWithResolvers();

    // The models of the files by their buffer, created when a file is first shown
    const models = useRef(new Map<FileBuffer<unknown>, FileModel>());

    // The scroll and cursor positions of the models that are currently not shown
    const viewStates = useRef(new Map<ITextModel, ICodeEditorViewState>());

    // Set while the text of a buffer is applied to its model, which isn't reported back
    const isApplyingBuffer = useRef(false);

    // Selections to restore once the file of an undone or redone change is shown
    const pendingSelections = useRef<monaco.ISelection[] | null>(null);

    const documentRef = useRef(props.document);
    documentRef.current = props.document;

    const onFileLinkClickRef = useRef(props.onFileLinkClick);
    onFileLinkClickRef.current = props.onFileLinkClick;

    const document = props.document;
    const activeFile = document?.activeFile ?? null;
    const isReadOnly =
      !!document && (document.capabilities.readOnly || !activeFile?.editable);
    const hasLastDeployFailed =
      !!document &&
      !!topologyStore.lookup.get(document.topologyId)?.lastDeployFailed;

    // The themes are defined once the editor is created, which also picks the scheme's theme
    useEffect(() => {
      if (editorRef.current) {
        monaco.editor.setTheme(monacoTheme(themeStore.scheme));
      }
    }, [themeStore.scheme]);

    useEffect(() => {
      void showFile();
    }, [document, activeFile]);

    // The editor is created after the first run of the effects, so it waits for it
    useEffect(() => {
      void editorReadyPromise.promise.then(() =>
        editorRef.current?.updateOptions({readOnly: isReadOnly}),
      );
    }, [isReadOnly, activeFile]);

    // The selections are recorded with changes, so undo and redo can restore them
    useEffect(() => {
      if (!document) return;

      document.setSelectionProviders(
        fileId => {
          const shown = editorRef.current?.getModel();
          const file = document.files.find(file => file.id === fileId);
          if (!shown || !file?.buffer) return null;

          return models.current.get(file.buffer)?.model === shown
            ? editorRef.current!.getSelections()
            : null;
        },
        () => props.graphSelection.snapshot,
      );

      return () => document.setSelectionProviders(null, null);
    }, [document]);

    // Models of closed documents are disposed
    useEffect(
      () =>
        reaction(
          () => [...tabStore.documents],
          open => {
            for (const [buffer, fileModel] of models.current) {
              if (!open.includes(fileModel.document)) {
                fileModel.dispose();
                viewStates.current.delete(fileModel.model);
                models.current.delete(buffer);
              }
            }
          },
        ),
      [],
    );

    useImperativeHandle(ref, () => ({
      undo: onTriggerUndo,
      redo: onTriggerRedo,
    }));

    async function showFile() {
      await editorReadyPromise.promise;

      const editor = editorRef.current;
      const file = documentRef.current?.activeFile;
      if (!editor || !file?.buffer || !documentRef.current) return;

      const {model} = modelOf(documentRef.current, file);

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

    /**
     * Returns the model of a file, created on first use. The model and the
     * buffer of the file follow each other: typing goes to the buffer, and
     * changes of the buffer from elsewhere are applied to the model.
     */
    function modelOf(document: EditorDocument, file: DocumentFile): FileModel {
      const buffer = file.buffer!;
      const existing = models.current.get(buffer);
      if (existing) return existing;

      const model = monaco.editor.createModel(
        buffer.text,
        languageOf(file),
        monaco.Uri.parse(modelUri(document, file)),
      );

      const contentListener = model.onDidChangeContent(() => {
        if (isApplyingBuffer.current) return;

        buffer.setText(model.getValue(), FileEditSource.TextEditor);
      });

      const bufferListener = (change: FileChange) => {
        if (change.source === FileEditSource.TextEditor) return;

        isApplyingBuffer.current = true;
        replaceContent(model, change.text);
        isApplyingBuffer.current = false;
      };
      buffer.onChange.register(bufferListener);

      const fileModel: FileModel = {
        model,
        file,
        document,
        dispose: () => {
          contentListener.dispose();
          buffer.onChange.unregister(bufferListener);
          model.dispose();
        },
      };

      models.current.set(buffer, fileModel);
      return fileModel;
    }

    function fileOfModel(model: ITextModel): FileModel | null {
      for (const fileModel of models.current.values()) {
        if (fileModel.model === model) return fileModel;
      }
      return null;
    }

    /**
     * Replaces the content of a model. Only the changed part is replaced, so
     * the cursor stays where it is.
     */
    function replaceContent(model: ITextModel, content: string) {
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
    }

    function showRestoredChange(restored: RestoredChange | null) {
      const document = documentRef.current;
      if (!restored || !document) return;

      props.graphSelection.setPendingSelection(restored.graphSelection ?? null);

      const selections = restored.selections as monaco.ISelection[] | null;
      if (restored.file !== document.activeFile.id) {
        // The selections are restored once the file is shown
        pendingSelections.current = selections;
        document.selectFile(restored.file);
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

    function onTriggerUndo() {
      const document = documentRef.current;
      if (!document || document.capabilities.readOnly) return;

      showRestoredChange(document.undo(props.graphSelection.snapshot));
    }

    function onTriggerRedo() {
      const document = documentRef.current;
      if (!document || document.capabilities.readOnly) return;

      showRestoredChange(document.redo());
    }

    const onGlobalKeyPress = useCallback(
      (event: KeyboardEvent) => {
        // Ctrl also matches the command key on macOS, and the key is lowercased for Caps Lock
        if (!event.ctrlKey && !event.metaKey) return;
        const key = event.key.toLowerCase();

        if (key === 's') {
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
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          onTriggerUndo();
        } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
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

    function initializeEditor() {
      if (!editorContainerRef.current || !schemaStore.clabSchema) {
        console.error('Failed to initialize monaco editor');
        return () => {};
      }

      const yamlPlugin = configureMonacoYaml(monaco, {
        enableSchemaRequest: false,
        schemas: [
          {
            fileMatch: [`**/*${CONTAINERLAB_SUFFIX}`],
            schema: toJS(schemaStore.clabSchema),
            // The schema comes from the server, Monaco only uses its URI as its name
            uri: 'https://containerlab.dev/clab.schema.json',
          },
        ],
      });

      const bindFileLinkProvider = monaco.languages.registerLinkProvider(
        {pattern: '**/*'},
        {
          provideLinks(model) {
            if (!fileOfModel(model)?.file.fileLinks) return {links: []};

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
            const model = editorRef.current?.getModel();
            if (model) {
              onFileLinkClickRef.current(model.getValueInRange(link.range));
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
              fileMatch: [`**/*${ANNOTATIONS_SUFFIX}`],
              schema: toJS(schemaStore.annotationsSchema),
            },
          ],
        });
      }

      const markerCallback = monaco.editor.onDidChangeMarkers(() => {
        const model = editorRef.current?.getModel();
        if (!model) return;

        const markers = monaco.editor.getModelMarkers({resource: model.uri});
        props.setValidationError?.(markers[0]?.message ?? null);
      });

      monaco.editor.defineTheme(monacoTheme('dark'), AntimonyTheme);
      monaco.editor.defineTheme(monacoTheme('light'), AntimonyLightTheme);

      const editor = monaco.editor.create(editorContainerRef.current, {
        model: null,
        theme: monacoTheme(themeStore.scheme),
        fontFamily: 'JetBrains Mono Variable, monospace',
        ariaLabel: 'Code editor',
      });
      editorRef.current = editor;

      editor.updateOptions(MonacoOptions);

      // Files are undone with the history of their document instead of the history of monaco
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

      const cursorListener = editor.onDidChangeCursorPosition(e => {
        props.onCursorChange?.(e.position.lineNumber, e.position.column);
      });

      return () => {
        cursorListener.dispose();
        editorRef.current?.dispose();
        for (const fileModel of models.current.values()) fileModel.dispose();
        models.current.clear();
        viewStates.current.clear();
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

        editorRef.current = null;
        resizeObserver.disconnect();
      };
    }, []);

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

/**
 * The URI of the model of a file. The schemas of the text editor apply to
 * models by the end of their URI, so files without a schema don't end with
 * their name, a bind file could be named like a topology.
 */
function modelUri(document: EditorDocument, file: DocumentFile) {
  const base = `inmemory://${document.id}/${file.id}`;

  switch (file.validation?.schema) {
    case 'containerlab':
      return base + CONTAINERLAB_SUFFIX;
    case 'annotations':
      return base + ANNOTATIONS_SUFFIX;
    default:
      return base;
  }
}

// The language of a file, picked from its name if the file doesn't name one
function languageOf(file: DocumentFile): string {
  if (file.language !== 'auto') return file.language;

  const extension = '.' + file.fileName.split('.').pop()?.toLowerCase();
  const match = monaco.languages
    .getLanguages()
    .find(language => language.extensions?.includes(extension));

  return match?.id ?? 'plaintext';
}

export default MonacoWrapper;
