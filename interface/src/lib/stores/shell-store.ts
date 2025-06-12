import {
  DataBinder,
  DataResponse,
  Subscription,
} from '@sb/lib/stores/data-binder/data-binder';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {Binding} from '@sb/lib/utils/binding';
import {
  Lab,
  LabCommand,
  ShellCommand,
  ShellCommandData,
  ShellData,
  ShellDataOut,
} from '@sb/types/domain/lab';
import {ErrorCodes} from '@sb/types/error-codes';
import {Result} from '@sb/types/result';
import {uuid4} from '@sb/types/types';
import {action, observable, ObservableMap, runInAction} from 'mobx';

export class ShellStore {
  @observable accessor currentShell: ShellData | null = null;
  @observable accessor openShells: Map<string, ShellData[]> =
    new ObservableMap();

  private readonly labCommandsSubscription: Subscription;
  public readonly onData: Binding<string> = new Binding();

  private currentDataSubscription: Subscription | null = null;

  private dataBinder: DataBinder;
  private statusMessageStore: StatusMessageStore;

  constructor(dataBinder: DataBinder, statusMessageStore: StatusMessageStore) {
    this.dataBinder = dataBinder;
    this.statusMessageStore = statusMessageStore;

    this.labCommandsSubscription =
      this.dataBinder.subscribeNamespace('lab-commands');

    this.handleData = this.handleData.bind(this);
    this.handleControl = this.handleControl.bind(this);

    this.dataBinder.subscribeNamespace('shell-commands', this.handleControl);
  }

  private handleData(data: string) {
    this.onData.update(data);
  }

  @action
  private handleControl(data: ShellCommandData) {
    if (!this.openShells.has(data.labId)) return;

    switch (data.command) {
      case ShellCommand.ShellError:
        this.handleShellError(data);
        break;
      case ShellCommand.ShellClose:
        this.handleShellClose(data);
        break;
    }
  }

  private handleShellError(data: ShellCommandData) {
    console.error('Received error in shell', data);
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

  public async fetchShellsForLab(lab: Lab) {
    if (!lab.instance) return;

    const result = (await this.labCommandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify({
        labId: lab.id,
        command: LabCommand.FetchShells,
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
        `shells/${this.currentShell.id}`,
        this.handleData,
      );
    }

    this.currentShell = {...shell};

    this.currentDataSubscription = this.dataBinder.subscribeNamespace(
      `shells/${this.currentShell.id}`,
      this.handleData,
    );
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

    const result = (await this.labCommandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify({
        labId: lab.id,
        node: nodeName,
        command: LabCommand.OpenShell,
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

    return shell;
  }

  public async closeShell(lab: Lab, shellId: string) {
    const labShells = this.openShells.get(lab.id)!;

    await this.labCommandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify({
        labId: lab.id,
        shellId: shellId,
        command: LabCommand.CloseShell,
      }),
    );

    runInAction(() => {
      this.openShells.set(
        lab.id,
        labShells.filter(shell => shell.id !== shellId),
      );
    });
  }
}
