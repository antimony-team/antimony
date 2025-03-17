import {AuthenticatedUser, EMPTY_AUTH_USER} from '@sb/types/domain/user';
import {computed, observable} from 'mobx';

import {UserCredentials} from '@sb/types/types';
import {Result} from '@sb/types/result';

export type DataResponse<T> = {
  payload: T;
  headers?: Headers;
};

export abstract class DataBinder {
  protected readonly fetchRetryTimer = 5000;

  @observable accessor authUser: AuthenticatedUser = EMPTY_AUTH_USER;
  @observable accessor isLoggedIn = false;

  @computed
  public get hasConnectionError() {
    return false;
  }

  public abstract logout(): void;

  public abstract login(
    credentials: UserCredentials | {},
    saveCookie: boolean
  ): Promise<boolean>;

  /**
   * This method is the primary way to retrieve data.
   */
  protected abstract fetch<R, T>(
    path: string,
    method: string,
    body?: R,
    authenticated?: boolean
  ): Promise<Result<DataResponse<T>>>;

  public async get<T>(
    path: string,
    authenticated = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(path, 'GET', undefined, authenticated);
  }

  public async delete<T>(
    path: string,
    authenticated = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(path, 'DELETE', undefined, authenticated);
  }

  public async post<R, T>(
    path: string,
    body: R,
    skipAuthentication = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(path, 'POST', body, skipAuthentication);
  }

  public async patch<R, T>(
    path: string,
    body: R,
    authenticated = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(path, 'PATCH', body, authenticated);
  }
}
