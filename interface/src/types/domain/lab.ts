import {RunTopology} from '@sb/types/domain/topology';
import {User} from '@sb/types/domain/user';
import {uuid4} from '@sb/types/types';

export type LabIn = {
  name: string;
  startTime: string;
  endTime?: string;
  topologyId: uuid4;
};

export type LabOut = LabIn & {
  id: uuid4;
  creator: User;
  collectionId: uuid4;

  topologyDefinition: string;

  instance: InstanceOut | null;
};

export type Lab = {
  id: uuid4;
  name: string;
  startTime: Date;
  endTime: Date | null;
  creator: User;
  state: InstanceState;

  topologyId: uuid4;
  collectionId: uuid4;
  topologyDefinition: RunTopology;

  instance: Instance | null;
};

export type InstanceOut = {
  name: string;
  deployed: Date;
  state: InstanceState;
  latestStateChange: Date;
  nodes: InstanceNode[];
  isRecovered: boolean;
};

export type Instance = InstanceOut & {
  nodeMap: Map<string, InstanceNode>;
};

export type InstanceNode = {
  name: string;
  ipv4: string;
  ipv6: string;
  port: number;
  kind: string;
  user: string;
  state: string;
  webSSH: string;
  containerId: string;
  containerName: string;
  interfaces: NodeInterface[];

  canRestart: boolean;
};

export type NodeInterface = {
  name: string;
  address: string;
  mtu: number;
  state: string;
};

export enum InstanceState {
  Deploying,
  Running,
  Stopping,
  Failed,

  Inactive = -1,
  Scheduled = -2,
}

export type NodeStats = {
  timestamp: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  interfaces: Record<string, NodeInterfaceStats>;
};

export type NodeInterfaceStats = {
  rxBps: number;
  txBps: number;
};

export const InstanceStates = Object.values(InstanceState).filter(
  instance => typeof instance === 'number',
);

export type ShellDataOut = {
  id: uuid4;
  node: string;
};

export type ShellData = ShellDataOut & {
  expired: boolean;
};

export type LabUpdateOut = {
  labId: string;
  newState: InstanceState | null;
};

export type ShellCommandData = {
  labId: string;
  node: string;
  shellId: string;
  command: ShellCommand;
  message: string;
};

export enum ShellCommand {
  ShellError,
  ShellClose,
}

export type RuntimeCommandPayload = {
  labId: string;
  command: RuntimeCommand;
  node?: string;
  shellId?: string;
};

export enum RuntimeCommand {
  DeployLab,
  DestroyLab,
  StartNode,
  StopNode,
  RestartNode,
  FetchShells,
  OpenShell,
  CloseShell,
}
