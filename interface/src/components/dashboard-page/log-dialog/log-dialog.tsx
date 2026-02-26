import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './log-dialog.sass';
import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';
import {useDataBinder} from '@sb/lib/stores/root-store';
import {DialogState} from '@sb/lib/utils/hooks';
import {Choose, Otherwise, When} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';

import {observer} from 'mobx-react-lite';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import containerLogLanguage from '@sb/lib/utils/container-log.language';
import charmbraceletLogLanguage from '@sb/lib/utils/charmbracelet-log.language';

import hljs from 'highlight.js';
import {Skeleton} from 'primereact/skeleton';

export interface LogDialogState {
  lab: Lab;

  // Container ID of the docker container or -1 for containerlab logs.
  source?: string;
}

interface LogDialogProps {
  dialogState: DialogState<LogDialogState>;
}

hljs.registerLanguage('container-log', containerLogLanguage);
hljs.registerLanguage('charmbracelet-log', charmbraceletLogLanguage);

const LogDialog = observer((props: LogDialogProps) => {
  const [lines, setLines] = useState<string[] | null>(null);

  const [logSource, setLogSource] = useState<string | number>(
    props.dialogState.state?.source ?? -1,
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const dataBinder = useDataBinder();

  const formatted = useMemo(() => {
    if (lines === null) return null;

    /*
     * We prefix every line with a line number and a random character to
     * separate the line number from the rest of the line.
     * This character will later get a CSS class with display: none
     * from highlight.js, so it's not visible.
     */
    let content = '';

    if (lines.length > 0) {
      content = [...lines, '', '', '']
        .map((line, i) => {
          // Add line number and remove escape characters
          return `${i + 1}ඞ${line.replace(/\u001B/g, '')}`;
        })
        .join('\n');
    }
    if (logSource === -1) {
      return hljs.highlight(content, {language: 'charmbracelet-log'}).value;
    } else {
      return hljs.highlight(content, {language: 'container-log'}).value;
    }
  }, [lines]);

  const skeleton = useMemo(() => {
    const generateWidth = () => Math.random() * (60 - 15) + 15;
    return Array.from({length: 24}, generateWidth).map((width, i) => (
      <div className="sb-log-dialog-loading-line" key={i}>
        <Skeleton width="80px"></Skeleton>
        <Skeleton width={`${width}rem`}></Skeleton>
      </div>
    ));
  }, [formatted]);

  const logSourceName = useMemo(() => {
    if (
      !props.dialogState.state ||
      !props.dialogState.state.lab.instance?.nodes
    ) {
      return '';
    }

    if (logSource === -1) {
      return 'Containerlab';
    } else {
      return props.dialogState.state.lab.instance.nodes.find(
        node => node.containerId === logSource,
      )!.name;
    }
  }, [props.dialogState.state, logSource]);

  useEffect(() => {
    if (!props.dialogState.state || !props.dialogState.isOpen) return;

    setLogSource(props.dialogState.state.source ?? -1);
  }, [props.dialogState.state?.source, props.dialogState.isOpen]);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.scrollTo(0, containerRef.current.scrollHeight);
  }, [formatted]);

  useEffect(() => {
    if (!props.dialogState.state) return;

    const namespace =
      logSource === -1
        ? `logs/${props.dialogState.state.lab.id}`
        : `logs/${props.dialogState.state.lab.id}/${logSource}`;

    setLines(null);
    dataBinder.subscribeNamespace(namespace, onLogs, onSocketConnect);

    return () => {
      dataBinder.unsubscribeNamespace(namespace, onLogs);
    };
  }, [props.dialogState.state, props.dialogState.isOpen, logSource]);

  function onSocketConnect() {
    setLines([]);
  }

  function onClose() {
    if (!props.dialogState.state) return;

    const namespace =
      logSource === -1
        ? `logs/${props.dialogState.state.lab.id}`
        : `logs/${props.dialogState.state.lab.id}/${logSource}`;

    dataBinder.unsubscribeNamespace(namespace, onLogs);

    props.dialogState.close();
  }

  function onLogs(data: string) {
    setLines(lines => [...(lines ?? []), data]);
  }

  const logSources = useMemo(() => {
    if (!props.dialogState.state?.lab.instance) return;

    const nodes = props.dialogState.state.lab.instance.nodes ?? [];

    return [
      {
        label: 'Containerlab',
        value: -1,
      },
      ...nodes.map(node => ({
        label: node.containerName,
        value: node.containerId,
      })),
    ];
  }, [props.dialogState.state]);

  return (
    <SBDialog
      onClose={onClose}
      isOpen={props.dialogState.isOpen}
      headerTitle={`Logs of ${props.dialogState.state?.lab.name} (${logSourceName})`}
      className="sb-log-dialog"
      hideButtons={true}
      draggable={true}
      resizeable={true}
      disableModal={true}
      headerIcon={
        <span className="material-symbols-outlined">document_search</span>
      }
    >
      <Choose>
        <When condition={formatted === null}>
          <div className="sb-log-dialog-loading">{skeleton}</div>
        </When>
        <When condition={formatted === ''}>
          <div ref={containerRef} className="sb-log-dialog-content">
            <div className="sb-log-dialog-lines-background" />
            <div className="sb-log-dialog-empty">
              <Choose>
                <When
                  condition={
                    logSource === -1 &&
                    props.dialogState.state!.lab.instance!.recovered
                  }
                >
                  <span>No logs found (Recovered Instance)</span>
                </When>
                <Otherwise>
                  <span>No logs found</span>
                </Otherwise>
              </Choose>
            </div>
          </div>
        </When>
        <Otherwise>
          <div ref={containerRef} className="sb-log-dialog-content">
            <div className="sb-log-dialog-lines-background" />
            <pre dangerouslySetInnerHTML={{__html: formatted!}} />
          </div>
        </Otherwise>
      </Choose>

      <SBDropdown
        id="log-selector"
        icon={option => {
          if (option.value === -1) {
            return <span className="material-symbols-outlined">terminal</span>;
          } else {
            return (
              <span className="material-symbols-outlined">deployed_code</span>
            );
          }
        }}
        hasFilter={(logSources && logSources.length > 10) ?? false}
        useSelectTemplate={true}
        useItemTemplate={true}
        value={logSource}
        options={logSources}
        onValueSubmit={setLogSource}
      />
    </SBDialog>
  );
});

export default LogDialog;
