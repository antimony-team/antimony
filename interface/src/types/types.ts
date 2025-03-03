import {Document, ToJSOptions} from 'yaml';

/**
 * Generic wrapper around the YAML document object for type consistency.
 */
export class YAMLDocument<T> extends Document {
  toJS(opt?: ToJSOptions & {[p: string]: unknown}): T {
    return super.toJS(opt) as T;
  }
}

export type uuid4 = string;

export type User = {
  id: uuid4;
  username: string;
  creation: string;
};

export type UserCredentials = {
  username: string;
  password: string;
};

export type Position = {
  x: number;
  y: number;
};

export type FieldType = string | string[] | boolean | number;

export interface FetchReport {
  state: FetchState;
  errorMessage?: string;
  errorCode?: string;
}

export enum FetchState {
  Pending,
  Done,
  Error,
}

export const DefaultFetchReport = {
  state: FetchState.Pending,
};
