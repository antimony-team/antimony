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

import {Topology} from '@sb/types/domain/topology';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {
  useAuthUser,
  useSchemaStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {
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
  getWorker() {
    return new Worker(new URL('monaco-yaml/yaml.worker', import.meta.url));
  },
};

interface MonacoWrapperProps {
  validationError: string | null;
  validationState: ValidationState;

  onSaveTopology: () => void;
  setContent: (content: string) => void;
  setValidationError: (error: string | null) => void;

  language: string;
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

    const onTopologyOpen = useCallback(
      (topology: Topology) => {
        setLastDeployFailed(topology.lastDeployFailed);

        /*
         * Don't replace the current model if the topology ID has not changed.
         * This happens whenever a topology is saved and reloaded automatically.
         */
        if (currentlyOpenTopology.current === topology.id) {
          return;
        }

        const readOnly =
          !authUser.isAdmin && authUser.id !== topology.creator.id;
        setReadOnly(readOnly);
        editorRef.current?.updateOptions({readOnly: readOnly});

        if (textModelRef.current) {
          textModelRef.current.setValue(topology.definition.toString());
          currentlyOpenTopology.current = topology.id;
        }
      },
      [hasLastDeployFailed],
    );

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

    useEffect(() => {
      topologyStore.manager.onEdit.register(onTopologyEdit);
      topologyStore.manager.onOpen.register(onTopologyOpen);

      if (textModelRef.current && topologyStore.manager.topology) {
        textModelRef.current.setValue(
          topologyStore.manager.topology.definition.toString(),
        );

        const readOnly =
          !authUser.isAdmin &&
          authUser.id !== topologyStore.manager.topology.creator.id;
        setReadOnly(readOnly);
        editorRef.current?.updateOptions({readOnly: readOnly});
      }

      return () => {
        topologyStore.manager.onEdit.unregister(onTopologyEdit);
        topologyStore.manager.onOpen.unregister(onTopologyOpen);
      };
    }, [onTopologyOpen, onTopologyEdit]);

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
            props.onSaveTopology();
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

      monaco.editor.defineTheme('antimonyTheme', AntimonyTheme);

      monaco.editor.onDidChangeMarkers(() => {
        const markers = monaco.editor.getModelMarkers({});
        if (markers.length > 0) {
          props.setValidationError(markers[0].message);
        }
      });

      textModelRef.current = monaco.editor.createModel(
        topologyStore.manager.topology?.definition.toString() ?? '',
        'yaml',
        monaco.Uri.parse(schemaModelUri),
      );

      editorRef.current = monaco.editor.create(editorContainerRef.current, {
        model: textModelRef.current,
        language: 'yaml',
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
              <Choose>
                <When
                  condition={props.validationState === ValidationState.Error}
                >
                  <i
                    className="pi pi-times"
                    style={{color: 'var(--danger-color-text)'}}
                  ></i>
                </When>
                <When
                  condition={props.validationState === ValidationState.Working}
                >
                  <span>Validating...</span>
                </When>
                <Otherwise>
                  <i
                    className="pi pi-check"
                    style={{color: 'var(--success-color-text)'}}
                  ></i>
                </Otherwise>
              </Choose>
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
