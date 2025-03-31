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
  instance?: Instance;
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
  state: InstanceState;
};

export type Instance = {
  deployed: Date;
  edgesharkLink: string;
  state: InstanceState;
  latestStateChange: Date;
  nodes: InstanceNode[];
};

export type InstanceNode = {
  name: string;
  ipv4: string;
  ipv6: string;
  port: number;
  user: string;
  webSSH: string;
  containerId: string;
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

export type NodeMeta = {
  name: string;
  user: string;
  host: string;
  port: number;
  webSsh: string;
};
