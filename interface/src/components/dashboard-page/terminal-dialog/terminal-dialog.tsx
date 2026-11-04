import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';
import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';
import {OverlayPanel} from 'primereact/overlaypanel';
import {SelectItem} from 'primereact/selectitem';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {
  useLabStore,
  useShellStore,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {DialogState, useReturnFocus} from '@sb/lib/utils/hooks';
import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {If} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';
import {uuid4} from '@sb/types/types';

import './terminal-dialog.sass';
import '@xterm/xterm/css/xterm.css';

// The dialog opens either a terminal of a node or a specific shell, e.g. the one of a terminal link
export type TerminalDialogState =
  | {lab: Lab; node: string; shellId?: never}
  | {lab: Lab; shellId: uuid4; node?: never};

interface TerminalDialogProps {
  dialogState: DialogState<TerminalDialogState>;

  isFullscreen: boolean;
  // Called with the shell of the selected tab when the terminal is in fullscreen, otherwise with null
  onFullscreenChange: (shellId: uuid4 | null) => void;
}

/** The link that opens a shell in a fullscreen terminal. */
export function terminalLink(labId: string, shellId: uuid4): string {
  const params = new URLSearchParams({l: labId, t: shellId});
  return `${location.origin}${location.pathname}#/?${params}`;
}

interface TerminalTab {
  shellId: uuid4;
  label: string;
  expired: boolean;
}

const decoder = new TextDecoder('utf-8');

const terminalFont = 'Iosevka';
// xterm's default font size
const terminalFontSize = 15;

const TerminalDialog = observer((props: TerminalDialogProps) => {
  const labStore = useLabStore();
  const shellStore = useShellStore();
  const statusMessageStore = useStatusMessages();

  const [isExpired, setExpired] = useState(false);
  const [isOpeningShell, setOpeningShell] = useState(false);
  const [currentTabs, setCurrentTabs] = useState<TerminalTab[]>([]);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const newTabOverlay = useRef<OverlayPanel>(null);
  const newTabReturnFocus = useReturnFocus();
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
    if (!props.dialogState.state) return [];

    // The lab of the dialog state doesn't get updated, so the nodes' current state is taken from the store
    const instance = labStore.lookup.get(
      props.dialogState.state.lab.id,
    )?.instance;
    if (!instance) return [];

    return instance.nodes
      .filter(node => new NodeActionChecker(instance, node).canOpenTerminal)
      .map(node => ({
        label: `${node.name} (${node.containerName})`,
        value: node.name,
      }));
  }, [props.dialogState.state, labStore.lookup]);

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

  // A fullscreen terminal that's closed stays maximized until it's gone, so it doesn't shrink back first
  const wasMaximized = useRef(props.isFullscreen);
  if (props.dialogState.isOpen) wasMaximized.current = props.isFullscreen;
  const isMaximized = wasMaximized.current;

  // Where the dialog was before it was maximized or restored, to animate it from there
  const rectBeforeResize = useRef<DOMRect | null>(null);

  useLayoutEffect(() => {
    const from = rectBeforeResize.current;
    rectBeforeResize.current = null;

    const dialog = dialogElement();
    if (
      !from ||
      !dialog ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const to = dialog.getBoundingClientRect();
    const translate = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
    const scale = `scale(${from.width / to.width}, ${from.height / to.height})`;

    dialog.animate(
      [
        {transformOrigin: 'top left', transform: `${translate} ${scale}`},
        {transformOrigin: 'top left', transform: 'none'},
      ],
      {duration: 200, easing: 'ease-out'},
    );
  }, [isMaximized]);

  function dialogElement(): HTMLElement | null {
    return terminalContainerRef.current?.closest('.p-dialog') ?? null;
  }

  // A shell can be open in several browser tabs, but it has only one size. It gets the size of the tab that's used.
  useEffect(() => {
    if (!props.dialogState.isOpen) return;

    const onFocus = () => void shellStore.claimCurrentShell();
    window.addEventListener('focus', onFocus);

    return () => window.removeEventListener('focus', onFocus);
  }, [props.dialogState.isOpen]);

  // In fullscreen, the link always leads to the selected tab
  useEffect(() => {
    if (!props.isFullscreen || !shellStore.currentShell) return;

    props.onFullscreenChange(shellStore.currentShell.id);
  }, [props.isFullscreen, shellStore.currentShell]);

  function onToggleFullscreen() {
    if (!shellStore.currentShell) return;

    rectBeforeResize.current = dialogElement()?.getBoundingClientRect() ?? null;
    props.onFullscreenChange(
      props.isFullscreen ? null : shellStore.currentShell.id,
    );
  }

  function onOpenInNewTab() {
    if (!props.dialogState.state || !shellStore.currentShell) return;

    window.open(
      terminalLink(props.dialogState.state.lab.id, shellStore.currentShell.id),
      '_blank',
    );

    // The terminal moves to the new tab. Kept open here, it would take the shell back whenever this window is used.
    onClose();
  }

  async function onOpen() {
    if (!props.dialogState.state) return;

    shellStore.clearExpiredShells();

    // The terminal measures its characters with the font when it's opened, so the font has to be loaded by then.
    // Otherwise, the size is calculated with the wider fallback font and the shell gets too few columns.
    await document.fonts.load(`${terminalFontSize}px ${terminalFont}`);

    if (terminalContainerRef.current) {
      if (termRef.current) {
        termRef.current.dispose();
      }
      if (fitRef.current) {
        fitRef.current.dispose();
      }
      termRef.current = new Terminal({
        fontFamily: `${terminalFont}, monospace`,
        fontSize: terminalFontSize,
        rows: 25,
        cols: 110,
      });

      fitRef.current = new FitAddon();
      termRef.current.loadAddon(fitRef.current);
      termRef.current.onResize(size => {
        // The size is kept even without a shell yet, so the shell that's opened next gets it
        shellStore.terminalSize = size;
        if (shellStore.currentShell) {
          void shellStore.resizeShell(shellStore.currentShell);
        }
      });

      termRef.current.open(terminalContainerRef.current);
      fitRef.current.fit();
      shellStore.terminalSize = {
        cols: termRef.current.cols,
        rows: termRef.current.rows,
      };

      // The terminal is fitted whenever its space changes, e.g. when the dialog is maximized, restored or resized,
      // or when the window is resized in fullscreen
      resizeObserver.current?.disconnect();
      resizeObserver.current = new ResizeObserver(() => fitRef.current?.fit());
      resizeObserver.current.observe(terminalContainerRef.current);

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

    const state = props.dialogState.state;

    if (state.shellId !== undefined) {
      const shell = currentShells.find(
        shell => shell.id === state.shellId && !shell.expired,
      );
      if (shell) {
        shellStore.switchToShell(shell);
      } else {
        statusMessageStore.error(
          "The terminal doesn't exist anymore.",
          'Failed to open terminal',
        );
        onClose();
      }
      return;
    }

    const shellsForNode = currentShells.filter(
      shell => shell.node === state.node,
    );

    if (shellsForNode.length < 1) {
      void switchToNewTab(state.node);
    } else {
      shellStore.switchToShell(shellsForNode[0]);
    }
  }

  function onClose() {
    resizeObserver.current?.disconnect();
    shellStore.onData.unregister(onData);
    shellStore.unsubscribeShell();

    if (props.isFullscreen) props.onFullscreenChange(null);

    props.dialogState.close();
  }

  async function switchToNewTab(nodeName: string) {
    if (!props.dialogState.state?.lab) return;

    // Opening a shell can take a few seconds, so the new tab button shows that it's still in progress
    setOpeningShell(true);
    const shell = await shellStore.openShell(
      props.dialogState.state.lab,
      nodeName,
    );
    setOpeningShell(false);
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

  function onTabClick(event: React.SyntheticEvent, index: number) {
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
      draggable={!props.isFullscreen}
      resizeable={!props.isFullscreen}
      disableModal={true}
      maximized={isMaximized}
      headerButtons={
        <>
          <Button
            outlined
            icon="pi pi-external-link"
            size="large"
            onClick={onOpenInNewTab}
            tooltip="Open in new tab"
            tooltipOptions={{position: 'bottom', showDelay: 500}}
            aria-label="Open in new tab"
          />
          <Button
            outlined
            icon={
              props.isFullscreen
                ? 'pi pi-window-minimize'
                : 'pi pi-window-maximize'
            }
            size="large"
            onClick={onToggleFullscreen}
            tooltip={props.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            tooltipOptions={{position: 'bottom', showDelay: 500}}
            aria-label={props.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          />
        </>
      }
      onShow={onOpen}
      onResizeEnd={onResizeEnd}
      headerIcon={
        <span className="material-symbols-outlined" aria-hidden="true">
          terminal_2
        </span>
      }
    >
      <div className="sb-terminal-tabs" role="tablist" aria-label="Terminals">
        {currentTabs.map((tab, i) => (
          <div
            key={i}
            className={classNames('sb-terminal-tab', {
              selected: i === tabIndex,
            })}
            role="tab"
            tabIndex={0}
            aria-selected={i === tabIndex}
            onClick={e => onTabClick(e, i)}
            onKeyDown={e => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTabClick(e, i);
              }
            }}
          >
            <div
              className={classNames('sb-terminal-tab-indicator', {
                expired: tab.expired,
              })}
              role="img"
              aria-label={tab.expired ? 'Expired' : 'Connected'}
            />
            <span className="sb-terminal-tab-label">{tab.label}</span>
            <Button
              className="sb-terminal-tab-close"
              icon="pi pi-times"
              onClick={e => onTabClose(e, tab.shellId, i)}
              aria-label="Close tab"
            />
          </div>
        ))}
        <Button
          icon="pi pi-plus"
          className="sb-terminal-tab-add"
          aria-label="Open new terminal"
          onClick={onNewTab}
          loading={isOpeningShell}
        />
      </div>
      <OverlayPanel
        ref={newTabOverlay}
        className="sb-terminal-new-tab-overlay"
        onShow={() => {
          newTabReturnFocus.onShow();
          newTabOverlay.current
            ?.getElement()
            ?.querySelector<HTMLElement>('[tabindex="0"]')
            ?.focus();
        }}
        onHide={() =>
          newTabReturnFocus.onHide(newTabOverlay.current?.getElement())
        }
      >
        {nodesInLab.map(node => (
          <div
            key={node.value}
            className="sb-terminal-new-tab-overlay-entry"
            role="button"
            tabIndex={0}
            onClick={() => onSelectNewTab(node.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectNewTab(node.value);
              }
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              deployed_code
            </span>
            <span>{node.label}</span>
          </div>
        ))}
      </OverlayPanel>

      <div className="sb-terminal-container sb-dark-scheme">
        <div className="sb-terminal-host" ref={terminalContainerRef} />
        <If condition={isExpired}>
          <div className="sb-terminal-expired">
            <span className="sb-terminal-expired-title">Terminal expired</span>
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
