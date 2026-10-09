import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';
import {OverlayPanel} from 'primereact/overlaypanel';
import {SelectItem} from 'primereact/selectitem';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {useLabStore, useShellStore} from '@sb/lib/stores/root-store';
import {DialogState} from '@sb/lib/utils/hooks';
import {If} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';
import {uuid4} from '@sb/types/types';

import './terminal-dialog.sass';
import '@xterm/xterm/css/xterm.css';

export interface TerminalDialogState {
  lab: Lab;
  node: string;
}

interface TerminalDialogProps {
  dialogState: DialogState<TerminalDialogState>;
}

interface TerminalTab {
  shellId: uuid4;
  label: string;
  expired: boolean;
}

const decoder = new TextDecoder('utf-8');

const TerminalDialog = observer((props: TerminalDialogProps) => {
  const labStore = useLabStore();
  const shellStore = useShellStore();

  const [isExpired, setExpired] = useState(false);
  const [currentTabs, setCurrentTabs] = useState<TerminalTab[]>([]);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const newTabOverlay = useRef<OverlayPanel>(null);
  const resetBeforeNextUpdate = useRef(false);

  const onData = useCallback((dataRaw: ArrayBuffer) => {
    if (!termRef.current) return;

    let data = decoder.decode(dataRaw, {stream: true});

    if (resetBeforeNextUpdate.current) {
      termRef.current.reset();
      setExpired(shellStore.currentShell?.expired ?? false);
      resetBeforeNextUpdate.current = false;

      data = data.replace(/^[\r\n]+/, '');
    }

    termRef.current.write(data);
  }, []);

  const nodesInLab: SelectItem[] = useMemo(() => {
    if (!props.dialogState.state?.lab?.instance) return [];

    const nodes = props.dialogState.state.lab.instance.nodes;

    return nodes.map(node => ({
      label: `${node.name} (${node.containerName})`,
      value: node.name,
    }));
  }, [props.dialogState.state, labStore.data]);

  const tabIndex = useMemo(() => {
    if (!shellStore.currentShell || !props.dialogState.state) return 0;

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id,
    );

    for (const [index, shell] of currentShells.entries()) {
      if (shell.id === shellStore.currentShell.id) {
        return index;
      }
    }

    return 0;
  }, [shellStore.currentShell]);

  useEffect(() => {
    if (!props.dialogState.state) return;

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id,
    );

    setCurrentTabs(
      currentShells
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: shell.node,
          expired: shell.expired,
        }))
        .toArray(),
    );

    setExpired(shellStore.currentShell?.expired ?? false);
  }, [shellStore.currentShell, shellStore.openShells]);

  async function onOpen() {
    if (!props.dialogState.state) return;

    shellStore.clearExpiredShells();

    if (terminalContainerRef.current) {
      if (termRef.current) {
        termRef.current.dispose();
      }
      if (fitRef.current) {
        fitRef.current.dispose();
      }
      termRef.current = new Terminal({
        fontFamily: 'Iosevka, monospace',
        rows: 25,
        cols: 110,
      });

      fitRef.current = new FitAddon();
      termRef.current.loadAddon(fitRef.current);
      termRef.current.onResize(size => {
        if (!props.dialogState.state || !shellStore.currentShell) return;

        shellStore.terminalSize = size;
        void shellStore.resizeShell(shellStore.currentShell);
      });

      termRef.current.open(terminalContainerRef.current);
      fitRef.current.fit();
      shellStore.terminalSize = {
        cols: termRef.current.cols,
        rows: termRef.current.rows,
      };

      termRef.current.onData((data: string) => {
        shellStore.sendData(data);
      });

      termRef.current.focus();
    }

    shellStore.onData.register(onData);

    await shellStore.fetchShellsForLab(props.dialogState.state.lab);

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id,
    );

    setCurrentTabs(
      currentShells
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: shell.node,
          expired: shell.expired,
        }))
        .toArray(),
    );

    const shellsForNode = currentShells.filter(
      shell => shell.node === props.dialogState.state!.node,
    );

    if (shellsForNode.length < 1) {
      void switchToNewTab(props.dialogState.state.node);
    } else {
      shellStore.switchToShell(shellsForNode[0]);
    }
  }

  function onClose() {
    shellStore.onData.unregister(onData);
    shellStore.unsubscribeShell();

    props.dialogState.close();
  }

  async function switchToNewTab(nodeName: string) {
    if (!props.dialogState.state?.lab) return;

    const shell = await shellStore.openShell(
      props.dialogState.state.lab,
      nodeName,
    );
    if (!shell) return;

    setCurrentTabs(
      shellStore
        .getShellsForLab(props.dialogState.state.lab.id)
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: shell.node,
          expired: shell.expired,
        }))
        .toArray(),
    );

    deferTerminalReset();

    shellStore.switchToShell(shell);
    termRef.current?.focus();
  }

  function onTabClick(event: React.MouseEvent<HTMLDivElement>, index: number) {
    if (!props.dialogState.state || !termRef.current) return;

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id,
    );

    deferTerminalReset();
    shellStore.switchToShell(currentShells[index]);

    // Set focus to the terminal after switching tabs
    termRef.current.focus();
  }

  function onNewTab(event: React.MouseEvent<HTMLButtonElement>) {
    newTabOverlay.current!.show(event, event.target);
  }

  /**
   * Instead of resetting the terminal right away, whenever the tab is switched,
   * to ensure a smoother user experience, we only reset the terminal as soon as
   * the first data packet of the new shell arrives.
   *
   * Alternatively, we start a 100 ms timeout to reset the terminal to account
   * for possible server delay or the websocket closing.
   */
  function deferTerminalReset() {
    resetBeforeNextUpdate.current = true;

    setTimeout(() => {
      if (resetBeforeNextUpdate.current) {
        termRef.current?.reset();
        resetBeforeNextUpdate.current = false;
      }
    }, 100);
  }

  function onSelectNewTab(nodeName: string) {
    newTabOverlay.current?.hide();
    void switchToNewTab(nodeName);
  }

  async function closeTab(shellId: string, closeIndex: number) {
    if (!props.dialogState.state?.lab) return;

    await shellStore.closeShell(props.dialogState.state.lab, shellId);

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id,
    );

    setCurrentTabs(
      currentShells
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: shell.node,
          expired: shell.expired,
        }))
        .toArray(),
    );

    if (closeIndex <= tabIndex) {
      deferTerminalReset();

      if (currentShells.length <= 0) {
        onClose();
        return;
      } else if (tabIndex < currentShells.length) {
        shellStore.switchToShell(currentShells[tabIndex]);
      } else {
        shellStore.switchToShell(currentShells[tabIndex - 1]);
      }

      termRef.current?.focus();
    }
  }

  function closeCurrentTab() {
    if (!shellStore.currentShell) return;

    void closeTab(shellStore.currentShell.id, tabIndex);
  }

  function onTabClose(
    event: React.MouseEvent<HTMLButtonElement>,
    shellId: string,
    closeIndex: number,
  ) {
    event.stopPropagation();
    void closeTab(shellId, closeIndex);
  }

  const expiredCloseButtonRef = useRef<Button | null>(null);

  useEffect(() => {
    if (!isExpired || !expiredCloseButtonRef.current) return;

    (expiredCloseButtonRef.current as unknown as HTMLButtonElement).focus();
  }, [isExpired]);

  function onResizeEnd() {
    fitRef.current!.fit();
  }

  return (
    <SBDialog
      onClose={onClose}
      isOpen={props.dialogState.isOpen}
      headerTitle={
        <>
          <span className="sb-dialog-title">Terminal</span>
          <span className="sb-dialog-subtitle">
            {props.dialogState.state?.lab.name}
          </span>
        </>
      }
      className="sb-terminal-dialog"
      hideButtons={true}
      draggable={true}
      resizeable={true}
      disableModal={true}
      onShow={onOpen}
      onResizeEnd={onResizeEnd}
      headerIcon={<span className="material-symbols-outlined">terminal_2</span>}
    >
      <div className="sb-terminal-tabs">
        {currentTabs.map((tab, i) => (
          <div
            key={i}
            className={classNames('sb-terminal-tab', {
              selected: i === tabIndex,
            })}
            onClick={e => onTabClick(e, i)}
          >
            <div
              className={classNames('sb-terminal-tab-indicator', {
                expired: tab.expired,
              })}
            />
            <span className="sb-terminal-tab-label">{tab.label}</span>
            <Button
              className="sb-terminal-tab-close"
              icon="pi pi-times"
              onClick={e => onTabClose(e, tab.shellId, i)}
            />
          </div>
        ))}
        <Button
          icon="pi pi-plus"
          className="sb-terminal-tab-add"
          aria-label="Open New Terminal"
          onClick={onNewTab}
        />
      </div>
      <OverlayPanel ref={newTabOverlay} className="sb-terminal-new-tab-overlay">
        {nodesInLab.map(node => (
          <div
            className="sb-terminal-new-tab-overlay-entry"
            onClick={() => onSelectNewTab(node.value)}
          >
            <span className="material-symbols-outlined">deployed_code</span>
            <span>{node.label}</span>
          </div>
        ))}
      </OverlayPanel>

      <div className="sb-terminal-container">
        <div className="sb-terminal-host" ref={terminalContainerRef} />
        <If condition={isExpired}>
          <div className="sb-terminal-expired">
            <span className="sb-terminal-expired-title">Terminal Expired</span>
            <span className="sb-terminal-expired-text">
              This terminal session is expired and can no longer be used
            </span>
            <Button
              outlined
              onClick={closeCurrentTab}
              ref={expiredCloseButtonRef}
            >
              Close
            </Button>
          </div>
        </If>
      </div>
    </SBDialog>
  );
});

export default TerminalDialog;
