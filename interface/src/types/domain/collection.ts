import {uuid4} from '@sb/types/types';

export type CollectionIn = {
  name: string;
  publicWrite: boolean;
  publicDeploy: boolean;
};

export type Collection = CollectionIn & {
  id: uuid4;
};
