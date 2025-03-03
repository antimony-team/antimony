import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import {toJS} from 'mobx';
import {isEqual} from 'lodash-es';
import {editor} from 'monaco-editor';
import {observer} from 'mobx-react-lite';
import {Tooltip} from 'primereact/tooltip';
import {monaco} from 'react-monaco-editor';
import {Monaco} from '@monaco-editor/react';
import {configureMonacoYaml} from 'monaco-yaml';
import MonacoEditor from 'react-monaco-editor/lib/editor';
import {AntimonyTheme, MonacoOptions} from './monaco.conf';

import {Topology} from '@sb/types/domain/topology';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {useSchemaStore, useTopologyStore} from '@sb/lib/stores/root-store';
import {TopologyEditReport, TopologyEditSource} from '@sb/lib/topology-manager';
import {ValidationState} from '@sb/components/editor-page/topology-editor/topology-editor';

import './monaco-wrapper.sass';

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
}

const MonacoWrapper = observer(
  forwardRef<MonacoWrapperRef, MonacoWrapperProps>((props, ref) => {
    const textModelRef = useRef<editor.ITextModel | null>(null);
    const monacoEditorRef = useRef<Monaco | null>(null);
    const currentlyOpenTopology = useRef<string | null>(null);

    const schemaStore = useSchemaStore();
    const topologyStore = useTopologyStore();

    const onTopologyOpen = useCallback((topology: Topology) => {
      /*
       * Don't replace the current model if the topology ID has not changed. This happens whenever
       * a topology is saved a reloaded automatically.
       */
      if (currentlyOpenTopology.current === topology.id) {
        return;
      }

      if (textModelRef.current) {
        textModelRef.current.setValue(topology.definition.toString());
        currentlyOpenTopology.current = topology.id;
      }
    }, []);

    const onTopologyEdit = useCallback((editReport: TopologyEditReport) => {
      if (
        !textModelRef.current ||
        editReport.source === TopologyEditSource.TextEditor
      ) {
        return;
      }

      const updatedContent = editReport.updatedTopology.definition.toString({
        collectionStyle: 'block',
      });
      const existingContent = textModelRef.current.getValue();

      const updatedContentStripped = updatedContent.replaceAll(' ', '');
      const existingContentStripped = existingContent.replaceAll(' ', '');

      if (!isEqual(updatedContentStripped, existingContentStripped)) {
        /*
         * For some reason the react-monaco-editor library adds multiple unto stops
         * to the history stack whenever the content is updated. This messes
         * up consecutive undos and redos. Therefore, we update the content
         * manually and don't use the library's built-in functionality.
         *
         * https://github.com/react-monaco-editor/react-monaco-editor/blob/e8c823fa5e0156687e6129502369f7e1521d061b/src/editor.tsx#L107
         */
        textModelRef.current.pushStackElement();
        textModelRef.current.pushEditOperations(
          [],
          [
            {
              range: textModelRef.current.getFullModelRange(),
              text: updatedContent,
            },
          ],
          undefined as never
        );
      }
    }, []);

    useEffect(() => {
      topologyStore.manager.onEdit.register(onTopologyEdit);
      topologyStore.manager.onOpen.register(onTopologyOpen);

      if (textModelRef.current) {
        textModelRef.current.setValue(
          topologyStore.manager.topology?.definition.toString() ?? ''
        );
      }

      return () => {
        topologyStore.manager.onEdit.unregister(onTopologyEdit);
        topologyStore.manager.onOpen.unregister(onTopologyOpen);
      };
    }, [onTopologyOpen, onTopologyEdit, topologyStore.manager]);

    useImperativeHandle(ref, () => ({
      undo: onTriggerUndo,
      redo: onTriggerRedo,
    }));

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
      [props]
    );

    useEffect(() => {
      window.addEventListener('keydown', onGlobalKeyPress);

      return () => {
        window.removeEventListener('keydown', onGlobalKeyPress);
      };
    }, [onGlobalKeyPress]);

    function onTriggerUndo() {
      monacoEditorRef.current?.editor.getEditors()[0].trigger('', 'undo', '');
    }

    function onTriggerRedo() {
      monacoEditorRef.current?.editor.getEditors()[0].trigger('', 'redo', '');
    }

    function onEditorMount(_editor: unknown, monaco: Monaco) {
      if (!schemaStore.clabSchema) return;

      monacoEditorRef.current = monaco;
      textModelRef.current = monaco.editor.getModel(
        monaco.Uri.parse(schemaModelUri)
      )!;

      monaco.editor.defineTheme('antimonyTheme', AntimonyTheme);

      editor.onDidChangeMarkers(() => {
        const markers = editor.getModelMarkers({});
        if (markers.length > 0) {
          props.setValidationError(markers[0].message);
        }
      });

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
    }

    function onContentChange() {
      if (textModelRef.current) {
        props.setContent(textModelRef.current.getValue());
      }
    }

    return (
      <If condition={schemaStore.clabSchema}>
        <div className="w-full h-full sb-monaco-wrapper">
          <div
            className="sb-monaco-wrapper-error"
            data-pr-tooltip={props.validationError ?? 'Schema Valid'}
            data-pr-position="right"
          >
            <Choose>
              <When condition={props.validationState === ValidationState.Error}>
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
          <MonacoEditor
            language="yaml"
            theme="antimonyTheme"
            options={MonacoOptions}
            onChange={onContentChange}
            editorDidMount={onEditorMount}
            uri={() => monaco.Uri.parse(schemaModelUri)}
          />
        </div>
      </If>
    );
  })
);

export default MonacoWrapper;
