import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './terminal-dialog.sass';
import {useShellStore} from '@sb/lib/stores/root-store';
import {DialogState} from '@sb/lib/utils/hooks';
import {Lab} from '@sb/types/domain/lab';
import {uuid4} from '@sb/types/types';
import {Terminal} from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

import {observer} from 'mobx-react-lite';
import {TabPanel, TabView, TabViewTabChangeEvent} from 'primereact/tabview';
import React, {useCallback, useMemo, useRef, useState} from 'react';

export interface TerminalDialogState {
  lab: Lab;
  nodeId: string | null;
}

interface TerminalDialogProps {
  dialogState: DialogState<TerminalDialogState>;
}

interface TerminalTab {
  shellId: uuid4;
  label: string;
}

const TerminalDialog = observer((props: TerminalDialogProps) => {
  const termRef = useRef<Terminal>();
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  const shellStore = useShellStore();

  const [currentTabs, setCurrentTabs] = useState<TerminalTab[]>([]);

  /*
   * When changing tabs, instead of resetting immediately, we wait with the
   * reset until data from the new tab arrives. This makes for a smoother
   * experience when switching between tabs.
   */
  const resetBeforeNextUpdate = useRef(false);

  const onData = useCallback((data: string) => {
    if (!termRef.current) return;

    if (resetBeforeNextUpdate.current) {
      termRef.current.reset();
      resetBeforeNextUpdate.current = false;
    }

    console.log('data:', data);
    termRef.current.write(data);
  }, []);

  function onClose() {
    shellStore.onData.unregister(onData);

    props.dialogState.close();
  }

  async function onOpen() {
    if (!props.dialogState.state) return;

    console.log('initializing trminal');
    console.log('container:', terminalContainerRef.current);

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

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id
    );

    setCurrentTabs(
      shellStore
        .getShellsForLab(props.dialogState.state.lab.id)
        .values()
        .map(shell => ({
          shellId: shell.id,
          label: `term-${currentTabs.length}`,
        }))
        .toArray()
    );

    if (props.dialogState.state.nodeId) {
      const shellsForNode = currentShells.filter(
        shell => shell.nodeId === props.dialogState.state!.nodeId
      );

      if (shellsForNode.length < 1) {
        const shell = await shellStore.openShell(
          props.dialogState.state.lab.id,
          props.dialogState.state.nodeId
        );
        if (!shell) return;

        setCurrentTabs([
          ...currentTabs,
          {
            shellId: shell.id,
            label: `term-${currentTabs.length}`,
          },
        ]);

        shellStore.switchToShell(shell);
        return;
      }
    }

    if (currentShells.length > 0) {
      shellStore.switchToShell(currentShells[0]);
    }
  }

  // useEffect(() => {
  //   console.log('container:', terminalContainerRef.current);
  //
  //   setTimeout(() => {
  //     console.log('container:', terminalContainerRef.current);
  //
  //     if (!terminalContainerRef.current) return;
  //
  //     term.onData((data: string) => {
  //       console.log('send data:', data);
  //       if (!subscriptionRef.current) return;
  //       console.log('send data2:', data);
  //       subscriptionRef.current.socket?.emit(
  //         'data',
  //         JSON.stringify({data: data})
  //       );
  //     });
  //     term.open(terminalContainerRef.current);
  //   }, 1000);
  // }, [props.dialogState.isOpen]);

  const tabIndex = useMemo(() => {
    if (!shellStore.currentShell || !props.dialogState.state) return 0;

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id
    );

    for (const [index, shell] of currentShells.entries()) {
      if (shell === shellStore.currentShell) {
        console.log('tabindex:', index);
        return index;
      }
    }

    return 0;
  }, [shellStore.currentShell]);

  function onTabSwitch(event: TabViewTabChangeEvent) {
    if (!props.dialogState.state || !termRef.current) return;

    resetBeforeNextUpdate.current = true;

    // We define a 200 ms timeout to reset the terminal even if no new data
    setTimeout(() => {
      if (resetBeforeNextUpdate.current) {
        termRef.current?.reset();
        resetBeforeNextUpdate.current = false;
      }
    }, 100);

    const currentShells = shellStore.getShellsForLab(
      props.dialogState.state.lab.id
    );
    shellStore.switchToShell(currentShells[event.index]);
    termRef.current.focus();
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
      onShow={onOpen}
      headerIcon={<span className="material-symbols-outlined">terminal</span>}
    >
      <TabView activeIndex={tabIndex} onTabChange={onTabSwitch} scrollable>
        {currentTabs.map(tab => {
          return (
            <TabPanel
              key={tab.shellId}
              header={
                <div className="sb-terminal-tab-header">
                  <span>{tab.label}</span>
                  <span onClick={() => {}}>
                    <i className="pi pi-times" />
                  </span>
                </div>
              }
            />
          );
        })}
        <TabPanel
          key="add"
          header={
            <div className="sb-terminal-tab-header-add">
              <span onClick={() => {}}>
                <i className="pi pi-plus" />
              </span>
            </div>
          }
        />
      </TabView>
      <div ref={terminalContainerRef}></div>
      {/*<SBDropdown*/}
      {/*  id="container-selector"*/}
      {/*  icon={<span className="material-symbols-outlined">deployed_code</span>}*/}
      {/*  hasFilter={(containers && containers.length > 10) ?? false}*/}
      {/*  useSelectTemplate={true}*/}
      {/*  useItemTemplate={true}*/}
      {/*  value={containerId}*/}
      {/*  options={containers}*/}
      {/*  onValueSubmit={setContainerId}*/}
      {/*/>*/}
    </SBDialog>
  );
});

export default TerminalDialog;
