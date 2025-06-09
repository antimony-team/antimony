import {
  DataBinder,
  DataResponse,
  Subscription,
} from '@sb/lib/stores/data-binder/data-binder';
import {Binding} from '@sb/lib/utils/binding';
import {LabCommand} from '@sb/types/domain/lab';
import {uuid4} from '@sb/types/types';
import {action, observable, ObservableMap} from 'mobx';

export class ShellStore {
  @observable accessor currentShell: ShellData | null = null;
  @observable accessor openShells: Map<string, ShellData[]> =
    new ObservableMap();

  private readonly labCommandsSubscription: Subscription;
  public readonly onData: Binding<string> = new Binding();
  private currentSubscription: Subscription | null = null;

  private dataBinder = new DataBinder();

  constructor(dataBinder: DataBinder) {
    this.dataBinder = dataBinder;

    this.labCommandsSubscription =
      this.dataBinder.subscribeNamespace('lab-commands');

    this.handleData = this.handleData.bind(this);
  }

  private handleData(data: string) {
    this.onData.update(data);
  }

  @action
  public getShellsForLab(labId: string): ShellData[] {
    if (!this.openShells.has(labId)) {
      this.openShells.set(labId, []);
    }

    return this.openShells.get(labId)!;
  }

  public switchToShell(shell: ShellData) {
    if (this.currentShell) {
      this.dataBinder.unsubscribeNamespace(
        `shells/${this.currentShell.id}`,
        this.handleData
      );
    }

    this.currentShell = shell;
    console.log('sweitch shell:', `/shells/${this.currentShell}`);

    this.currentSubscription = this.dataBinder.subscribeNamespace(
      `shells/${this.currentShell.id}`,
      this.handleData
    );
  }

  public sendData(data: string) {
    if (!this.currentSubscription) return;

    this.currentSubscription.socket!.emit('data', data);
  }

  @action
  public async openShell(
    labId: string,
    nodeId: string
  ): Promise<ShellData | null> {
    if (!this.openShells.has(labId)) {
      this.openShells.set(labId, []);
    }

    const result = (await this.labCommandsSubscription.socket!.emitWithAck(
      'data',
      JSON.stringify({
        labId: labId,
        nodeId: nodeId,
        command: LabCommand.OpenShell,
      })
    )) as DataResponse<uuid4>;

    console.log('result:', result);

    if (!('payload' in result)) {
      console.log('Failed to open terminal:', result);
      return null;
    }

    const shell = {
      id: result.payload,
      nodeId: nodeId,
    };

    this.openShells.get(labId)!.push(shell);

    return shell;
  }
}

type ShellData = {
  id: uuid4;
  nodeId: string;
};
