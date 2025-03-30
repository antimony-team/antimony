import {User} from '@sb/types/domain/user';
import {uuid4} from '@sb/types/types';

export type LabIn = {
  name: string;
  startTime: string;
  endTime: string;
  topologyId: uuid4;
};

export type Lab = LabIn & {
  id: uuid4;
  creator: User;
  collectionId: uuid4;
  instance?: Instance;
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
  Scheduled = -1,
  Deploying,
  Stopping,
  Running,
  Failed,
  Done,
}

export type NodeMeta = {
  name: string;
  user: string;
  host: string;
  port: number;
  webSsh: string;
};
