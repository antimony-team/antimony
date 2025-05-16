import {User} from '@sb/types/domain/user';
import {uuid4} from '@sb/types/types';

export type LabIn = {
  name: string;
  startTime: string;
  endTime: string;
  topologyId: uuid4;
};

export type LabOut = LabIn & {
  id: uuid4;
  creator: User;
  collectionId: uuid4;
  instance?: InstanceOut;
};

export type Lab = {
  id: uuid4;
  name: string;
  startTime: Date;
  endTime: Date;
  creator: User;

  topologyId: uuid4;
  collectionId: uuid4;

  instance?: Instance;
  instanceName?: string;
  state: InstanceState;
};

export type InstanceOut = {
  deployed: Date;
  edgesharkLink: string;
  state: InstanceState;
  latestStateChange: Date;
  nodes: InstanceNode[];
  recovered: boolean;
};

export type Instance = InstanceOut & {
  nodeMap: Map<string, InstanceNode>;
};

export type InstanceNode = {
  name: string;
  ipv4: string;
  ipv6: string;
  port: number;
  user: string;
  webSSH: string;
  containerId: string;
  containerName: string;
};

export enum InstanceState {
  Deploying,
  Running,
  Stopping,
  Failed,

  Inactive = -1,
  Scheduled = -2,
}

export const InstanceStates = Object.values(InstanceState).filter(
  instance => typeof instance === 'number'
);

export type LabCommandData = {
  labId: string;
  command: LabCommand;
  node?: string;
};

export enum LabCommand {
  Deploy,
  Destroy,
  StopNode,
  StartNode,
}
