import {uuid4} from '@sb/types/types';

export type LabIn = {
  name: string;
  startDate: string;
  endDate: string;
  topologyId: uuid4;
};

export type Lab = LabIn & {
  id: uuid4;
  collectionId: uuid4;
  nodeMeta: NodeMeta[];
  edgesharkLink: string;
  runnerId: uuid4;
  latestStateChange: string;
  state: LabState;
};

export type NodeMeta = {
  name: string;
  user: string;
  host: string;
  port: number;
  webSsh: string;
};

export enum LabState {
  Scheduled,
  Deploying,
  Running,
  Failed,
  Done,
}
