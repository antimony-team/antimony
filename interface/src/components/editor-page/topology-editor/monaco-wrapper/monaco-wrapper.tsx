import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {toJS} from 'mobx';
import {isEqual} from 'lodash-es';
import {observer} from 'mobx-react-lite';
import {Tooltip} from 'primereact/tooltip';
import {configureMonacoYaml} from 'monaco-yaml';
import {AntimonyTheme, MonacoOptions} from './monaco.conf';

import * as monaco from 'monaco-editor';

import {BindFile, Topology} from '@sb/types/domain/topology';
import {Choose, If, Otherwise, When} from '@sb/types/control';
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
import {ValidationState} from '@sb/components/editor-page/topology-editor/topology-editor';

import './monaco-wrapper.sass';

import ICodeEditor = monaco.editor.ICodeEditor;
import ITextModel = monaco.editor.ITextModel;

const schemaModelUri = 'inmemory://schema.yaml';

window.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case 'json':
        return new Worker(
          new URL(
            'monaco-editor/esm/vs/language/json/json.worker.js',
            import.meta.url,
          ),
        );
      case 'css':
      case 'scss':
      case 'less':
        return new Worker(
          new URL(
            'monaco-editor/esm/vs/language/css/css.worker.js',
            import.meta.url,
          ),
        );
      case 'html':
      case 'handlebars':
      case 'razor':
        return new Worker(
          new URL(
            'monaco-editor/esm/vs/language/html/html.worker.js',
            import.meta.url,
          ),
        );
      case 'typescript':
      case 'javascript':
        return new Worker(
          new URL(
            'monaco-editor/esm/vs/language/typescript/ts.worker.js',
            import.meta.url,
          ),
        );
      case 'yaml':
        return new Worker(new URL('monaco-yaml/yaml.worker', import.meta.url));
      default:
        return new Worker(
          new URL(
            'monaco-editor/esm/vs/editor/editor.worker.js',
            import.meta.url,
          ),
        );
    }
  },
};

interface MonacoWrapperProps {
  validationError: string | null;
  showValidation: boolean;
  validationState: ValidationState;

  onSaveFile: () => void;
  onBindFileLinkClick: (bindFileName: string) => void;

  setContent: (content: string) => void;
  setValidationError?: (error: string | null) => void;
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

    const textModelRef = useRef<ITextModel | null>(null);
    const editorRef = useRef<ICodeEditor | null>(null);

    const currentlyOpenTopology = useRef<string | null>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);

    const authUser = useAuthUser();
    const schemaStore = useSchemaStore();
    const topologyStore = useTopologyStore();

    const onTopologyOpen = useCallback((topology: Topology) => {
      /*
       * Don't replace the current model if the topology ID has not changed.
       * This happens whenever a topology is saved and reloaded automatically.
       */
      if (currentlyOpenTopology.current === topology.id) {
        return;
      }

      setLastDeployFailed(topology.lastDeployFailed);
      setReadOnly(!authUser.isAdmin && authUser.id !== topology.creator.id);

      if (textModelRef.current) {
        monaco.editor.setModelLanguage(textModelRef.current, 'yaml');
        textModelRef.current.setValue(topology.definition.toString());
        currentlyOpenTopology.current = topology.id;
      }
    }, []);

    const onBindFileOpen = useCallback((bindFile: BindFile) => {
      console.log('on bind file open 1');
      const topology = topologyStore.lookup.get(bindFile.topologyId);
      if (!topology) return;

      console.log('on bind file open 2');

      setLastDeployFailed(topology.lastDeployFailed);
      setReadOnly(!authUser.isAdmin && authUser.id !== topology.creator.id);

      if (textModelRef.current) {
        const languages = monaco.languages.getLanguages();
        const ext = '.' + bindFile.filePath.split('.').pop()?.toLowerCase();

        const match = languages.find(lang => lang.extensions?.includes(ext));
        const language = match?.id ?? 'text';

        console.log('Bind file language: ', language);

        monaco.editor.setModelLanguage(textModelRef.current, language);
        textModelRef.current.setValue(bindFile.content);
        currentlyOpenTopology.current = null;

        console.log('on bind file open 3');
      }
    }, []);

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

      if (!isEqual(updatedContentStripped, existingContentStripped)) {
        setContent(updatedContent);
      }
    }, []);

    const onBindFileEdit = useCallback((editReport: BindFileEditReport) => {
      if (
        !textModelRef.current ||
        editReport.source === BindFileEditSource.TextEditor
      ) {
        return;
      }

      setContent(editReport.updatedBindFile.content);
    }, []);

    useEffect(() => {
      topologyStore.manager.onTopologyEdit.register(onTopologyEdit);
      topologyStore.manager.onTopologyOpen.register(onTopologyOpen);

      topologyStore.manager.onBindFileEdit.register(onBindFileEdit);
      topologyStore.manager.onBindFileOpen.register(onBindFileOpen);

      if (textModelRef.current) {
        if (topologyStore.manager.topology) {
          textModelRef.current.setValue(
            topologyStore.manager.topology.definition.toString(),
          );

          setReadOnly(
            !authUser.isAdmin &&
              authUser.id !== topologyStore.manager.topology.creator.id,
          );
        } else if (topologyStore.manager.bindFile) {
          const bindFile = topologyStore.manager.bindFile;
          const topology = topologyStore.lookup.get(bindFile.topologyId);

          if (topology) {
            textModelRef.current.setValue(bindFile.content);
            setReadOnly(
              !authUser.isAdmin && authUser.id !== topology.creator.id,
            );
          }
        }
      }

      return () => {
        topologyStore.manager.onTopologyEdit.unregister(onTopologyEdit);
        topologyStore.manager.onTopologyOpen.unregister(onTopologyOpen);

        topologyStore.manager.onBindFileEdit.unregister(onBindFileEdit);
        topologyStore.manager.onBindFileOpen.unregister(onBindFileOpen);
      };
    }, [onTopologyOpen, onTopologyEdit]);

    useEffect(() => {
      editorRef.current?.updateOptions({readOnly: isReadOnly});
    }, [isReadOnly]);

    useImperativeHandle(ref, () => ({
      undo: onTriggerUndo,
      redo: onTriggerRedo,
      setContent: setContent,
    }));

    function setContent(content: string) {
      if (!textModelRef.current) return;

      textModelRef.current.setValue(content);
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
      if (!editorContainerRef.current || !schemaStore.clabSchema) return;

      // if (props.language === 'yaml') {
      configureMonacoYaml(monaco, {
        enableSchemaRequest: false,
        schemas: [
          {
            fileMatch: ['**/*.yaml'],
            schema: toJS(schemaStore.clabSchema),
            uri: process.env.SB_CLAB_SCHEMA_URL!,
          },
        ],
      });

      monaco.languages.registerLinkProvider(
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
              props.onBindFileLinkClick(
                textModelRef.current!.getValueInRange(link.range),
              );
            }
            return link;
          },
        },
      );

      monaco.editor.onDidChangeMarkers(() => {
        const markers = monaco.editor.getModelMarkers({});
        if (markers.length > 0 && props.setValidationError) {
          props.setValidationError(markers[0].message);
        }
      });
      // }

      monaco.editor.defineTheme('antimonyTheme', AntimonyTheme);

      // console.log("[monaco init] ")

      textModelRef.current = monaco.editor.createModel(
        // topologyStore.manager.topology?.definition.toString() ?? '',
        '',
        // props.language,
        'text',
        monaco.Uri.parse(schemaModelUri),
      );

      editorRef.current = monaco.editor.create(editorContainerRef.current, {
        model: textModelRef.current,
        // language: props.language,
        language: 'text',
        theme: 'antimonyTheme',
        fontFamily: 'JetBrains Mono, monospace',
      });

      editorRef.current.updateOptions(MonacoOptions);
      editorRef.current.onDidChangeModelContent(onContentChange);
    }

    useEffect(() => {
      if (!editorContainerRef.current) return;

      initializeEditor();

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => editorRef.current?.layout());
      });
      resizeObserver.observe(editorContainerRef.current);

      return () => {
        editorRef.current?.dispose();
        textModelRef.current?.dispose();

        textModelRef.current = null;
        editorRef.current = null;
        resizeObserver.disconnect();
      };
    }, []);

    function onContentChange() {
      if (textModelRef.current) {
        props.setContent(textModelRef.current.getValue());
      }
    }

    return (
      <If condition={schemaStore.clabSchema}>
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
            <div
              className="sb-monaco-wrapper-error"
              data-pr-tooltip={props.validationError ?? 'Schema Valid'}
              data-pr-position="right"
            >
              {props.showValidation && (
                <Choose>
                  <When
                    condition={props.validationState === ValidationState.Error}
                  >
                    <i
                      className="pi pi-times"
                      style={{color: 'var(--danger-color-text)'}}
                    />
                  </When>
                  <When
                    condition={
                      props.validationState === ValidationState.Working
                    }
                  >
                    <i
                      className="pi pi-spinner pi-spin"
                      style={{color: 'var(--warning-color-text)'}}
                    />
                  </When>
                  <Otherwise>
                    <i
                      className="pi pi-check"
                      style={{color: 'var(--success-color-text)'}}
                    />
                  </Otherwise>
                </Choose>
              )}
              <Tooltip
                className="sb-monaco-wrapper-error-tooltip"
                target=".sb-monaco-wrapper-error"
              />
            </div>
            <div ref={editorContainerRef} style={{height: '100%'}}></div>
          </div>
        </div>
      </If>
    );
  }),
);

export default MonacoWrapper;
