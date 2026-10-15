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

/**
 * The top-level screen the app is showing.
 */
export enum AppPhase {
  /** Waiting for the initial handshake with the API to complete. */
  Connecting,

  /** The API is unreachable and the user is not logged in. */
  Offline,

  /** Connection with API established, waiting for the user to authenticate. */
  Unauthenticated,

  /** Authenticated, waiting for the stores to finish their initial fetch. */
  Loading,

  /** Everything is loaded and the app is interactive. */
  Ready,
}

/**
 * Connection state of a single backend service as shown in the connection
 * status list.
 */
export enum ConnectionState {
  /** The state can't be determined yet, e.g. before the user is logged in. */
  Unknown,

  /** The connection is down and is currently being retried. */
  Retrying,

  /** The connection is up. */
  Ok,
}
