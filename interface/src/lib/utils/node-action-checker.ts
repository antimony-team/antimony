import {
  Instance,
  InstanceNode,
  InstanceNodeState,
  InstanceState,
} from '@sb/types/domain/lab';

export class NodeActionChecker {
  private readonly instance?: Instance | null;
  private readonly node?: InstanceNode | null;

  constructor(instance?: Instance | null, node?: InstanceNode | null) {
    this.instance = instance;
    this.node = node;
  }

  public get canStart() {
    return (
      this.isInstanceRunning &&
      this.node?.canRestart &&
      this.assertNodeState(InstanceNodeState.Stopped)
    );
  }

  public get canStop() {
    return (
      this.isInstanceRunning &&
      this.node?.canRestart &&
      this.assertNodeState(InstanceNodeState.Running)
    );
  }

  public get canRestart() {
    return (
      this.isInstanceRunning &&
      this.node?.canRestart &&
      this.assertNodeState(InstanceNodeState.Running)
    );
  }

  public get canOpenTerminal() {
    return (
      this.isInstanceRunning && this.assertNodeState(InstanceNodeState.Running)
    );
  }

  public get canShowLogs() {
    return (
      this.isInstanceRunning &&
      this.assertNodeState(
        InstanceNodeState.Starting,
        InstanceNodeState.Running,
      )
    );
  }

  private get isInstanceRunning() {
    return this.instance?.state === InstanceState.Running;
  }

  private assertNodeState(...states: InstanceNodeState[]) {
    return this.node && states.includes(this.node.state);
  }
}
