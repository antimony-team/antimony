import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './log-dialog.sass';
import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';
import {useDataBinder} from '@sb/lib/stores/root-store';
import {DialogState} from '@sb/lib/utils/hooks';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';

import {observer} from 'mobx-react-lite';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import hljs from '@sb/lib/utils/hljs/highlight';
import {Skeleton} from 'primereact/skeleton';
import {runInAction} from 'mobx';
import {Image} from 'primereact/image';

export const ANTIMONY_LOG = '__antimony__';

export interface LogDialogState {
  lab: Lab;

  // Container ID of the docker container or `ANTIMONY_LOG` for Antimony server logs.
  source: string;
}

interface LogDialogProps {
  dialogState: DialogState<LogDialogState>;
}

const LogDialog = observer((props: LogDialogProps) => {
  const [lines, setLines] = useState<string[] | null>(null);

  const logSourceChangedRef = useRef(false);
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
    if (props.dialogState.state?.source === ANTIMONY_LOG) {
      return hljs.highlight(content, {language: 'antimony-log'}).value;
    } else {
      return hljs.highlight(content, {language: 'generic-log'}).value;
    }
  }, [lines]);

  // Reset log source to containerlab logs if instance is restarted
  // useEffect(() => {
  //   if (!props.dialogState.state?.lab.instance?.nodes?.length) {
  //     if (props.dialogState.state) {
  //       runInAction(() => {
  //         props.dialogState.state!.source = ANTIMONY_LOG;
  //       });
  //     }
  //   }
  // }, [props.dialogState.state?.lab.instance]);

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

    if (props.dialogState.state.source === ANTIMONY_LOG) {
      return 'Antimony';
    } else {
      return (
        props.dialogState.state.lab.instance.nodes.find(
          node => node.containerId === props.dialogState.state!.source,
        )?.name ?? 'Unknown'
      );
    }
  }, [props.dialogState.state?.source]);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.scrollTo(0, containerRef.current.scrollHeight);
  }, [formatted]);

  useEffect(() => {
    if (!props.dialogState.state) return;

    const namespace = currentLogNamespace();

    logSourceChangedRef.current = true;
    dataBinder.subscribeNamespace(namespace, onLogs, onSocketConnect);

    return () => {
      dataBinder.unsubscribeNamespace(namespace, onLogs);
    };
  }, [props.dialogState.state?.source, props.dialogState.isOpen]);

  function currentLogNamespace() {
    if (!props.dialogState.state) return '';

    return props.dialogState.state.source === ANTIMONY_LOG
      ? `logs/${props.dialogState.state.lab.id}`
      : `logs/${props.dialogState.state.lab.id}/${props.dialogState.state.source}`;
  }

  function onSocketConnect() {
    setLines([]);
  }
  function onClose() {
    if (!props.dialogState.state) return;

    dataBinder.unsubscribeNamespace(currentLogNamespace(), onLogs);
    props.dialogState.close();
  }

  function onLogs(data: string) {
    if (logSourceChangedRef.current) {
      setLines([data]);
      logSourceChangedRef.current = false;
      return;
    }

    setLines(lines => [...(lines ?? []), data]);
  }

  const logSources = useMemo(() => {
    if (!props.dialogState.state?.lab.instance) return;

    const nodes = props.dialogState.state.lab.instance.nodes ?? [];

    return [
      {
        label: 'Antimony',
        value: ANTIMONY_LOG,
      },
      ...nodes.map(node => ({
        label: node.containerName,
        value: node.containerId,
      })),
    ];
  }, [props.dialogState.state?.lab]);

  function onLogSourceChange(value: string) {
    runInAction(() => {
      if (!props.dialogState.state) return;
      props.dialogState.state!.source = value;
    });
  }

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
                    props.dialogState.state!.source === ANTIMONY_LOG &&
                    props.dialogState.state!.lab.instance?.isRecovered
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
          <div className="sb-log-dialog-lines-background" />
          <div ref={containerRef} className="sb-log-dialog-content">
            <pre dangerouslySetInnerHTML={{__html: formatted!}} />
          </div>
        </Otherwise>
      </Choose>

      <If condition={logSources?.length}>
        <SBDropdown
          id="log-selector"
          className="sb-log-dialog-slector"
          icon={option => {
            if (option.value === ANTIMONY_LOG) {
              return (
                <Image
                  src="/icons/antimony-outline.svg"
                  width="18px"
                  style={{
                    paddingLeft: '2.3px',
                    paddingRight: '1px',
                    color: 'white',
                  }}
                />
              );
            } else {
              return (
                <span className="material-symbols-outlined">deployed_code</span>
              );
            }
          }}
          hasFilter={(logSources && logSources.length > 10) ?? false}
          useSelectTemplate={true}
          useItemTemplate={true}
          value={props.dialogState.state?.source}
          options={logSources}
          onValueSubmit={onLogSourceChange}
        />
      </If>
    </SBDialog>
  );
});

export default LogDialog;
