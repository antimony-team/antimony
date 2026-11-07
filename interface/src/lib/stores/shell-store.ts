import {action, observable, ObservableMap, runInAction} from 'mobx';

import {
  DataBinder,
  DataResponse,
  Subscription,
} from '@sb/lib/stores/data-binder/data-binder';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {Binding} from '@sb/lib/utils/binding';
import {
  Lab,
  RuntimeCommand,
  ShellCommand,
  ShellCommandData,
  ShellData,
  ShellDataOut,
} from '@sb/types/domain/lab';
import {ErrorCodes} from '@sb/types/error-codes';
import {Result} from '@sb/types/result';
import {uuid4} from '@sb/types/types';

export class ShellStore {
  @observable accessor currentShell: ShellData | null = null;
  @observable accessor openShells: ObservableMap<string, ShellData[]> =
    new ObservableMap();
  @observable accessor terminalSize: {cols: number; rows: number} = {
    cols: 80,
    rows: 24,
  };

  public readonly onData: Binding<ArrayBuffer> = new Binding();
  private readonly commandsSubscription: Subscription;
  private currentDataSubscription: Subscription | null = null;

  private dataBinder: DataBinder;
  private statusMessageStore: StatusMessageStore;

  private currentOnConnect: (() => void) | undefined = undefined;

  // A shell can be shown in several browser windows, but it has only one size, the one of the window that used it
  // last. The windows tell each other which shells they use, so the others redraw them once they're used again.
  private readonly windowChannel = new BroadcastChannel('antimony-shells');
  // The shells this window has shown, and the ones another window has used since
  private readonly shownShells = new Set<string>();
  private readonly shellsUsedElsewhere = new Set<string>();

  constructor(dataBinder: DataBinder, statusMessageStore: StatusMessageStore) {
    this.dataBinder = dataBinder;
    this.statusMessageStore = statusMessageStore;

    this.windowChannel.onmessage = (event: MessageEvent<string>) => {
      this.shellsUsedElsewhere.add(event.data);
    };

    this.commandsSubscription = this.dataBinder.subscribeNamespace('cmd');

    this.handleData = this.handleData.bind(this);
    this.handleControl = this.handleControl.bind(this);

    this.dataBinder.subscribeNamespace('shell-control', this.handleControl);
  }

  @action
  public clearExpiredShells() {
    const shellsToRemove = new Set<string>();

    for (const [labId, shells] of this.openShells) {
      for (const shell of shells) {
        if (shell.expired) {
          shellsToRemove.add(shell.id);
        }
      }

      this.openShells.set(
        labId,
        this.openShells
          .get(labId)!
          .filter(shell => !shellsToRemove.has(shell.id)),
      );
    }
  }

  public async fetchShellsForLab(lab: Lab) {
    if (!lab.instance) return;

    const result = (await this.commandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify({
        labId: lab.id,
        command: RuntimeCommand.FetchShells,
      }),
    )) as DataResponse<ShellDataOut[]>;

    if (!('payload' in result)) {
      console.error('Failed to fetch shells:', result);
      return this.openShells.get(lab.id)!;
    } else if (!result.payload) {
      return;
    }

    const activeShellMap = new Map<uuid4, ShellDataOut>(
      result.payload.map(shell => [shell.id, shell]),
    );

    runInAction(() => {
      let labShells: ShellData[] = [];

      if (this.openShells.has(lab.id)) {
        labShells = this.openShells.get(lab.id)!.map(shell => {
          if (!activeShellMap.has(shell.id)) {
            return {
              ...shell,
              expired: true,
            };
          } else {
            activeShellMap.delete(shell.id);

            return {
              ...shell,
              expired: false,
            };
          }
        });
      }

      activeShellMap.forEach(shell => {
        labShells.push({
          ...shell,
          expired: false,
        });
      });

      this.openShells.set(lab.id, labShells);
    });
  }

  public getShellsForLab(labId: string): ShellData[] {
    if (!this.openShells.has(labId)) {
      this.openShells.set(labId, []);
    }

    return this.openShells.get(labId)!;
  }

  @action
  public switchToShell(shell: ShellData) {
    if (this.currentShell) {
      this.dataBinder.unsubscribeNamespace(
        `shell/${this.currentShell.id}`,
        this.handleData,
        this.currentOnConnect,
      );
    }

    this.currentShell = {...shell};
    this.currentOnConnect = () => {
      void this.resizeShell(shell);
    };

    this.currentDataSubscription = this.dataBinder.subscribeNamespace(
      `shell/${this.currentShell.id}`,
      this.handleData,
      this.currentOnConnect,
    );

    // The shell may still have the size of another terminal, e.g. in another browser tab. The resize on connect
    // isn't enough, as the namespace may already be connected.
    void this.claimCurrentShell();
  }

  /**
   * Gives the current shell the size of this window's terminal. If the shell's screen may have been drawn for
   * another size, because the shell wasn't opened in this window or another window used it since, it's redrawn.
   */
  public async claimCurrentShell() {
    const shell = this.currentShell;
    if (!shell || shell.expired) return;

    const needsRedraw =
      !this.shownShells.has(shell.id) || this.shellsUsedElsewhere.has(shell.id);
    this.shownShells.add(shell.id);
    this.shellsUsedElsewhere.delete(shell.id);
    this.windowChannel.postMessage(shell.id);

    await this.resizeShell(shell);

    // Ctrl+L makes the shell redraw its screen. It's sent after the resize, so the shell redraws for the new size.
    if (needsRedraw && this.currentShell?.id === shell.id) {
      this.sendData('\x0c');
    }
  }

  /** Returns an open shell of the node, or opens a new one if it has none. */
  public async findOrOpenShell(
    lab: Lab,
    nodeName: string,
  ): Promise<ShellData | null> {
    await this.fetchShellsForLab(lab);

    const shell = this.getShellsForLab(lab.id).find(
      shell => shell.node === nodeName && !shell.expired,
    );

    return shell ?? this.openShell(lab, nodeName);
  }

  @action
  public unsubscribeShell() {
    if (!this.currentShell) return;

    if (this.currentDataSubscription) {
      this.dataBinder.unsubscribeNamespace(
        `shell/${this.currentShell.id}`,
        this.handleData,
      );
    }

    this.currentShell = null;
  }

  public sendData(data: string) {
    if (!this.currentDataSubscription) return;

    this.currentDataSubscription.socket!.emit('data', data);
  }

  @action
  public async openShell(
    lab: Lab,
    nodeName: string,
  ): Promise<ShellData | null> {
    if (!this.openShells.has(lab.id)) {
      this.openShells.set(lab.id, []);
    }

    const result = (await this.commandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify({
        labId: lab.id,
        node: nodeName,
        command: RuntimeCommand.OpenShell,
        cols: this.terminalSize.cols,
        rows: this.terminalSize.rows,
      }),
    )) as DataResponse<uuid4>;

    if (!('payload' in result)) {
      const error = Result.createErr(result).error;
      if (error.code === ErrorCodes.ErrorShellLimitReached) {
        this.statusMessageStore.error(
          'Shell limit reached',
          'Failed to open new shell',
        );

        return null;
      }

      this.statusMessageStore.error(error.message, 'Failed to open new shell');
      console.error('Failed to open shell:', error);
      return null;
    }

    const shell: ShellData = {
      id: result.payload,
      node: nodeName,
      expired: false,
    };

    this.openShells.get(lab.id)!.push(shell);
    // A new shell has only been drawn for this window, so it doesn't need to be redrawn
    this.shownShells.add(shell.id);

    return shell;
  }

  public async closeShell(lab: Lab, shellId: string) {
    const labShells = this.openShells.get(lab.id);
    if (!labShells) return;

    const shell = labShells.find(shell => shell.id === shellId);
    if (!shell) return;

    runInAction(() => {
      this.openShells.set(
        lab.id,
        labShells.filter(shell => shell.id !== shellId),
      );
    });

    // We wait 50 ms before actually closing the shell so that the tab can properly
    // close before getting flagged as inactive. This is purely a UX thing.
    setTimeout(async () => {
      const result = (await this.commandsSubscription.socket!.emitWithAck(
        'data',
        JSON.stringify({
          labId: lab.id,
          shellId: shellId,
          command: RuntimeCommand.CloseShell,
        }),
      )) as DataResponse<void>;

      if (!('payload' in result)) {
        this.statusMessageStore.error(
          Result.createErr(result).error.message,
          'Failed to close shell',
        );
      }
    }, 20);
  }

  public async resizeShell(shell: ShellData | null) {
    if (!shell || shell.expired) return;

    const result = (await this.commandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify({
        shellId: shell.id,
        command: RuntimeCommand.ResizeShell,
        cols: this.terminalSize.cols,
        rows: this.terminalSize.rows,
      }),
    )) as DataResponse<void>;

    if (!('payload' in result)) {
      this.statusMessageStore.error(
        Result.createErr(result).error.message,
        'Failed to resize shell',
      );
    }
  }

  private handleData(data: ArrayBuffer) {
    this.onData.update(data);
  }

  @action
  private handleControl(data: DataResponse<ShellCommandData>) {
    if (!this.openShells.has(data.payload.labId)) return;

    switch (data.payload.command) {
      case ShellCommand.ShellError:
        this.handleShellError(data.payload);
        break;
      case ShellCommand.ShellClose:
        this.handleShellClose(data.payload);
        break;
    }
  }

  private handleShellError(data: ShellCommandData) {
    console.error('Received error in shell', data);
    this.handleShellClose(data);
  }

  @action
  private handleShellClose(data: ShellCommandData) {
    this.openShells.set(
      data.labId,
      this.openShells.get(data.labId)!.map(shell => {
        if (shell.id === data.shellId) {
          return {
            ...shell,
            expired: true,
          };
        }

        return shell;
      }),
    );

    if (this.currentShell?.id === data.shellId) {
      this.currentShell = {
        ...this.currentShell,
        expired: true,
      };
    }
  }
}
