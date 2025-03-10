import {computed, observable, runInAction} from 'mobx';

import {fetchResource} from '@sb/lib/utils/utils';
import {UserCredentials} from '@sb/types/types';
import {Result} from '@sb/types/result';

export type DataResponse<T> = {
  payload: T;
  headers?: Headers;
};

export abstract class DataBinder {
  protected readonly fetchRetryTimer = 5000;

  @observable accessor isAdmin = false;
  @observable accessor isLoggedIn = false;
  @observable accessor hasExternalError = false;

  @computed
  public get hasConnectionError() {
    return this.hasExternalError;
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
    isExternal?: boolean,
    skipAuthentication?: boolean
  ): Promise<Result<DataResponse<T>>>;

  public async get<T>(
    path: string,
    isExternal = false,
    skipAuthentication = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(
      path,
      'GET',
      undefined,
      isExternal,
      skipAuthentication
    );
  }

  public async delete<T>(
    path: string,
    isExternal = false,
    skipAuthentication = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(
      path,
      'DELETE',
      undefined,
      isExternal,
      skipAuthentication
    );
  }

  public async post<R, T>(
    path: string,
    body: R,
    isExternal = false,
    skipAuthentication = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(path, 'POST', body, isExternal, skipAuthentication);
  }

  public async patch<R, T>(
    path: string,
    body: R,
    isExternal = false,
    skipAuthentication = false
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(
      path,
      'PATCH',
      body,
      isExternal,
      skipAuthentication
    );
  }

  /**
   * Fetches additional data over the network.
   *
   * This method always operates the same and is separate from the main fetch method.
   */
  protected async fetchExternal<R, T>(
    path: string,
    method: string,
    body?: R,
    requestHeaders?: HeadersInit
  ): Promise<Result<DataResponse<T>>> {
    const response = await fetchResource(path, method, body, requestHeaders);

    if (!response || !response.ok) {
      runInAction(() => (this.hasExternalError = true));
      await new Promise(resolve => setTimeout(resolve, this.fetchRetryTimer));
      return this.fetchExternal(path, method, body, requestHeaders);
    }

    runInAction(() => (this.hasExternalError = false));

    return Result.createOk({
      payload: JSON.parse(await response.text()),
      headers: response.headers,
    });
  }
}
