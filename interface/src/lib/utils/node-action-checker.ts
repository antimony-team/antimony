import {Instance, InstanceNode, InstanceState} from '@sb/types/domain/lab';

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
      this.node?.state !== 'started'
    );
  }

  public get canStop() {
    return (
      this.isInstanceRunning &&
      this.node?.canRestart &&
      this.node?.state !== 'exited'
    );
  }

  public get canRestart() {
    return this.isInstanceRunning && this.node?.canRestart;
  }

  public get canOpenTerminal() {
    return this.isInstanceRunning && this.node?.state === 'running';
  }

  public get canShowLogs() {
    return this.isInstanceRunning && this.node !== undefined;
  }

  private get isInstanceRunning() {
    return this.instance?.state === InstanceState.Running;
  }
}
