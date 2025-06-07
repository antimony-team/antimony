import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './terminal-dialog.sass';
import {useDataBinder} from '@sb/lib/stores/root-store';
import {DialogState} from '@sb/lib/utils/hooks';
import {Lab} from '@sb/types/domain/lab';

import {observer} from 'mobx-react-lite';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Subscription} from '@sb/lib/stores/data-binder/data-binder';
import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';
import {Terminal} from '@xterm/xterm';
import {toJS} from 'mobx';

import 'xterm/css/xterm.css';

export interface TerminalDialogState {
  lab: Lab;
  containerId: string;
}

interface TerminalDialogProps {
  dialogState: DialogState<TerminalDialogState>;
}

const TerminalDialog = observer((props: TerminalDialogProps) => {
  const dataBinder = useDataBinder();
  const [containerId, setContainerId] = useState<string | null>(
    props.dialogState.state?.containerId ?? null
  );
  const [term, setTerm] = useState<Terminal>(
    () =>
      new Terminal({
        fontFamily: 'Iosevka, monospace',
      })
  );

  const subscriptionRef = useRef<Subscription | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  const containerName = useMemo(() => {
    if (!props.dialogState.state?.lab.instance?.nodes || !containerId)
      return '';

    console.log('state: ', toJS(props.dialogState.state));

    return props.dialogState.state.lab.instance!.nodes.find(
      node => node.containerId === containerId
    )!.name;
  }, [props.dialogState.state, containerId]);

  useEffect(() => {
    if (!props.dialogState.state || !props.dialogState.isOpen) return;

    setContainerId(props.dialogState.state.containerId ?? null);
  }, [props.dialogState.state?.containerId, props.dialogState.isOpen]);

  useEffect(() => {
    if (!props.dialogState.state || !containerId) return;

    const namespace = `term/${containerId}`;

    console.log('subscribing trminal');
    setTerm(
      new Terminal({
        fontFamily: 'Iosevka, monospace',
      })
    );
    subscriptionRef.current = dataBinder.subscribeNamespace(
      namespace,
      onData,
      onSocketConnect
    );

    return () => {
      console.log('unsibscribing terminal');
      dataBinder.unsubscribeNamespace(namespace, onData);
    };
  }, [props.dialogState.state, props.dialogState.isOpen, containerId]);

  function onSocketConnect() {}

  function onClose() {
    if (!props.dialogState.state || !containerId) return;

    const namespace = `term/${containerId}`;

    dataBinder.unsubscribeNamespace(namespace, onData);
    term.dispose();

    props.dialogState.close();
  }

  function onData(data: {data: string}) {
    console.log('data:', data);
    term.write(data.data);
  }

  useEffect(() => {
    console.log('container:', terminalContainerRef.current);

    setTimeout(() => {
      console.log('container:', terminalContainerRef.current);

      if (!terminalContainerRef.current) return;

      term.onData((data: string) => {
        console.log('send data:', data);
        if (!subscriptionRef.current) return;
        console.log('send data2:', data);
        subscriptionRef.current.socket?.emit(
          'data',
          JSON.stringify({data: data})
        );
      });
      term.open(terminalContainerRef.current);
    }, 1000);
  }, [props.dialogState.isOpen]);

  const containers = useMemo(() => {
    if (!props.dialogState.state?.lab.instance) return;

    const nodes = props.dialogState.state.lab.instance.nodes ?? [];

    return nodes.map(node => ({
      label: node.containerName,
      value: node.containerId,
    }));
  }, [props.dialogState.state]);

  return (
    <SBDialog
      onClose={onClose}
      isOpen={props.dialogState.isOpen}
      headerTitle={`Terminal of ${props.dialogState.state?.lab.name} (${containerName})`}
      className="sb-terminal-dialog"
      hideButtons={true}
      draggable={true}
      resizeable={true}
      // disableModal={true}
      headerIcon={
        <span className="material-symbols-outlined">border_color</span>
      }
    >
      <div ref={terminalContainerRef}></div>
      <SBDropdown
        id="container-selector"
        icon={<span className="material-symbols-outlined">deployed_code</span>}
        hasFilter={(containers && containers.length > 10) ?? false}
        useSelectTemplate={true}
        useItemTemplate={true}
        value={containerId}
        options={containers}
        onValueSubmit={setContainerId}
      />
    </SBDialog>
  );
});

export default TerminalDialog;
