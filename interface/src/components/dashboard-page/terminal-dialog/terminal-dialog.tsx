import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './terminal-dialog.sass';
import {useShellStore} from '@sb/lib/stores/root-store';
import {DialogState} from '@sb/lib/utils/hooks';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';
import {uuid4} from '@sb/types/types';
import {Terminal} from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {ListBox} from 'primereact/listbox';
import {OverlayPanel} from 'primereact/overlaypanel';
import {SelectItem} from 'primereact/selectitem';
import {TabPanel, TabView, TabViewTabChangeEvent} from 'primereact/tabview';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

type OptionGroupOptions = {
  optionGroup: {
    label: string;
    value: string;
  };
};

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

const TerminalDialog = observer((props: TerminalDialogProps) => {
  const shellStore = useShellStore();

  const [isExpired, setExpired] = useState(false);
  const [currentTabs, setCurrentTabs] = useState<TerminalTab[]>([]);

  const termRef = useRef<Terminal>();
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const newTabOverlay = useRef<OverlayPanel>(null);
  const newTabAnchor = useRef<TabPanel>(null);
  const resetBeforeNextUpdate = useRef(false);

  const onData = useCallback((data: string) => {
    if (!termRef.current) return;

    if (resetBeforeNextUpdate.current) {
      termRef.current.reset();
      setExpired(shellStore.currentShell?.expired ?? false);
      resetBeforeNextUpdate.current = false;
    }

    termRef.current.write(data);
  }, []);

  const nodesInLab: SelectItem[] = useMemo(() => {
    if (!props.dialogState.state?.lab?.instance) return [];

    const nodes = props.dialogState.state.lab.instance.nodes;

    return nodes.map(node => ({
      label: `${node.name} (${node.containerId})`,
      value: node.name,
    }));
  }, [props.dialogState.state]);

  const tabIndex = useMemo(() => {
    if (!shellStore.currentShell || !props.dialogState.state) return 0;

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id
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
      props.dialogState.state.lab.id
    );

    setCurrentTabs(
      currentShells
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: shell.node,
          expired: shell.expired,
        }))
        .toArray()
    );

    setExpired(shellStore.currentShell?.expired ?? false);
  }, [shellStore.currentShell, shellStore.openShells]);

  async function onOpen() {
    if (!props.dialogState.state) return;

    if (terminalContainerRef.current) {
      if (termRef.current) {
        termRef.current.dispose();
      }
      termRef.current = new Terminal({
        fontFamily: 'Iosevka, monospace',
        rows: 25,
      });
      termRef.current.open(terminalContainerRef.current);

      termRef.current.onData((data: string) => {
        shellStore.sendData(data);
      });

      termRef.current.focus();
    }

    shellStore.onData.register(onData);

    await shellStore.fetchShellsForLab(props.dialogState.state.lab);

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id
    );

    setCurrentTabs(
      currentShells
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: shell.node,
          expired: shell.expired,
        }))
        .toArray()
    );

    const shellsForNode = currentShells.filter(
      shell => shell.node === props.dialogState.state!.node
    );

    if (shellsForNode.length < 1) {
      void switchToNewTab(props.dialogState.state.node);
    } else {
      shellStore.switchToShell(shellsForNode[0]);
    }
  }

  function onClose() {
    shellStore.onData.unregister(onData);

    props.dialogState.close();
  }

  async function switchToNewTab(nodeName: string) {
    if (!props.dialogState.state?.lab) return;

    const shell = await shellStore.openShell(
      props.dialogState.state.lab,
      nodeName
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
        .toArray()
    );

    deferTerminalReset();

    console.log('switchToNewTab, switch to new shell: ', shell);
    shellStore.switchToShell(shell);
  }

  function onTabSwitch(event: TabViewTabChangeEvent) {
    if (!props.dialogState.state || !termRef.current) return;

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id
    );
    if (event.index >= currentShells.length) {
      newTabOverlay.current!.show(
        event.originalEvent,
        newTabAnchor.current! as unknown as HTMLElement
      );
    } else {
      deferTerminalReset();

      console.log(
        'onTabSwitch, switch to index: ',
        event.index,
        'current shells:',
        currentShells
      );
      shellStore.switchToShell(currentShells[event.index]);
      termRef.current.focus();
    }
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

  const nodeListTemplate = (option: OptionGroupOptions) => {
    return (
      <div
        className="flex align-items-center gap-3"
        onClick={() => onSelectNewTab(option.optionGroup.value)}
      >
        <span className="material-symbols-outlined">deployed_code</span>
        <span>{option.optionGroup.label}</span>
      </div>
    );
  };

  async function closeTab(shellId: string, closeIndex: number) {
    if (!props.dialogState.state?.lab) return;

    await shellStore.closeShell(props.dialogState.state.lab, shellId);

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id
    );

    setCurrentTabs(
      currentShells
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: shell.node,
          expired: shell.expired,
        }))
        .toArray()
    );

    if (closeIndex <= tabIndex) {
      deferTerminalReset();

      if (currentShells.length <= 0) {
        onClose();
      } else if (tabIndex < currentShells.length) {
        shellStore.switchToShell(currentShells[tabIndex]);
      } else {
        shellStore.switchToShell(currentShells[tabIndex - 1]);
      }
    }
  }

  function closeCurrentTab() {
    if (!shellStore.currentShell) return;

    void closeTab(shellStore.currentShell.id, tabIndex);
  }

  function onTabClose(
    event: React.MouseEvent<HTMLDivElement>,
    shellId: string,
    closeIndex: number
  ) {
    event.stopPropagation();

    void closeTab(shellId, closeIndex);
  }

  return (
    <SBDialog
      onClose={onClose}
      isOpen={props.dialogState.isOpen}
      headerTitle={`Terminal for ${props.dialogState.state?.lab.name}`}
      className="sb-terminal-dialog"
      hideButtons={true}
      draggable={true}
      resizeable={true}
      disableModal={true}
      onShow={onOpen}
      headerIcon={<span className="material-symbols-outlined">terminal</span>}
    >
      <TabView activeIndex={tabIndex} onTabChange={onTabSwitch} scrollable>
        {currentTabs.map((tab, index) => {
          return (
            <TabPanel
              key={tab.shellId}
              header={
                <div className="sb-terminal-tab-header">
                  <Choose>
                    <When condition={tab.expired}>
                      <span>{tab.label} (Expired)</span>
                    </When>
                    <Otherwise>
                      <span>{tab.label}</span>
                    </Otherwise>
                  </Choose>
                  <div
                    className="sb-terminal-tab-header-close"
                    onClick={e => onTabClose(e, tab.shellId, index)}
                  >
                    <i className="pi pi-times" />
                  </div>
                </div>
              }
            />
          );
        })}
        {/* Special tab entry for button to add new tabs */}
        <TabPanel
          key="add"
          ref={newTabAnchor}
          header={
            <div className="sb-terminal-tab-header-add">
              <span onClick={() => {}}>
                <i className="pi pi-plus" />
              </span>
            </div>
          }
        />
      </TabView>
      <OverlayPanel ref={newTabOverlay} className="sb-terminal-new-tab-overlay">
        <ListBox
          options={nodesInLab!}
          className="w-full md:w-14rem"
          optionGroupLabel="value"
          optionGroupTemplate={nodeListTemplate}
        />
      </OverlayPanel>

      <div className="sb-terminal-container" ref={terminalContainerRef}>
        <If condition={isExpired}>
          <div className="sb-terminal-expired">
            <span className="sb-terminal-expired-title">Terminal Expired</span>
            <span className="sb-terminal-expired-text">
              This terminal is expired and can no longer be used
            </span>
            <Button onClick={closeCurrentTab}>Close</Button>
          </div>
        </If>
      </div>
    </SBDialog>
  );
});

export default TerminalDialog;
