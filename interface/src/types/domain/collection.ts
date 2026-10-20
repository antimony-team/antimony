import {User} from '@sb/types/domain/user';
import {uuid4} from '@sb/types/types';

export type CollectionIn = {
  name: string;
  publicWrite: boolean;
  publicDeploy: boolean;
};

export type Collection = CollectionIn & {
  id: uuid4;
  creator: User;
};
