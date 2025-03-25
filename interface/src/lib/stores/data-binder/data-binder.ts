import {AuthenticatedUser, EMPTY_AUTH_USER} from '@sb/types/domain/user';
import Cookies from 'js-cookie';
import {io, Socket} from 'socket.io-client';
import {action, computed, observable, runInAction} from 'mobx';

import {fetchResource} from '@sb/lib/utils/utils';
import {UserCredentials} from '@sb/types/types';
import {Result} from '@sb/types/result';

type AuthResponse = {
  token: string;
  isAdmin: boolean;
};

export type DataResponse<T> = {
  payload: T;
  headers?: Headers;
};

export class DataBinder {
  private readonly apiUrl = process.env.SB_API_SERVER_URL ?? 'localhost';

  protected readonly fetchRetryTimer = 5000;

  // Set to true when all preloading and auth processes have finished
  @observable accessor isReady = false;

  // Set to true if the client is authenticated and has access to the resources
  @observable accessor isLoggedIn = false;

  @observable accessor authUser: AuthenticatedUser = EMPTY_AUTH_USER;

  @observable accessor hasAPIError = false;
  @observable accessor hasSocketError = false;

  private refreshTokenPromise: Promise<Result<null>> | null = null;
  private accessToken: string = '';

  private socketMap: Map<string, Socket> = new Map();

  constructor() {
    const accessToken = Cookies.get('accessToken');
    if (accessToken !== undefined) {
      this.refreshToken().then(result => {
        if (result.isOk()) {
          this.processAccessToken(accessToken);
          this.isLoggedIn = true;
          this.isReady = true;
        } else if (Cookies.get('authOidc') === 'true') {
          window.location.replace(this.apiUrl + '/users/login/openid');
          return Result.createErr({code: -1, message: 'Unauthorized'});
        } else {
          this.isReady = true;
        }
      });
    } else {
      this.isReady = true;
    }
  }

  public subscribeNamespace<T>(namespace: string, onData: (data: T) => void) {
    this.unsibscribeNamespace(namespace);

    const socket = io(`/${namespace}`, {
      auth: {
        token: this.accessToken,
      },
    });

    socket.on('connect', () => {
      console.log(`[SOCK] Connected to ns ${namespace}`);
    });

    socket.on('disconnect', () => {
      console.log(`[SOCK] Disconnected from ns ${namespace}`);
    });

    socket.on('backlog', data => {
      for (const msg of data) onData(msg);
    });

    socket.on('connect_error', () => {
      // Inactive socket means that the server rejected the connection
      if (!socket.active) {
        this.refreshToken().then(result => {
          if (result.isOk()) {
            // Retry socket subscription if token was refreshed
            this.subscribeNamespace(namespace, onData);
          }
        });
      }
    });

    socket.on('data', onData);

    this.socketMap.set(namespace, socket);
  }

  public unsibscribeNamespace(namespace: string) {
    if (this.socketMap.has(namespace)) {
      this.socketMap.get(namespace)!.disconnect();
    }
  }

  public async login(
    credentials: UserCredentials,
    saveCookie: boolean
  ): Promise<boolean> {
    const tokenResponse = await this.post<UserCredentials, AuthResponse>(
      '/users/login',
      credentials,
      false
    );

    if (!tokenResponse.isOk()) {
      console.error(
        '[AUTH] Failed to login user with provided credentials. Aborting.'
      );
      return false;
    }

    if (saveCookie) {
      // Cookies.set('isAdmin', String(this.isAdmin));
    }

    return true;
  }

  @action
  protected async fetch<R, T>(
    path: string,
    method: string,
    body?: R,
    authenticated = true
  ): Promise<Result<DataResponse<T>>> {
    if (authenticated && !this.isLoggedIn) {
      return Result.createErr({code: -1, message: 'Unauthorized'});
    }

    const response = await fetchResource(this.apiUrl + path, method, body, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });

    if (!response || response.status === 504) {
      runInAction(() => (this.hasAPIError = true));
      await new Promise(resolve => setTimeout(resolve, this.fetchRetryTimer));
      return this.fetch(path, method, body, authenticated);
    }

    // Server error, logout and return generic error
    if (response.status >= 500) {
      // runInAction(() => (this.hasAPIError = true));
      // this.logout();
      return Result.createErr({code: -1, message: 'Server Error'});
    }

    // Acecss token is expired, attempt to refresh before retrying
    if (response.status === 498) {
      const refreshResponse = await this.refreshToken();
      if (refreshResponse.isErr()) {
        if (Cookies.get('authOidc') === 'true') {
          window.location.replace(this.apiUrl + '/users/login/openid');
          return refreshResponse;
        }
        return refreshResponse;
      } else {
        return this.fetch(path, method, body, authenticated);
      }
    }

    // Auth token is expired or invalid
    if (response.status === 401) {
      this.logout();
      return Result.createErr({code: -1, message: 'Unauthorized request.'});
    }

    let responseBody = {payload: {} as T};

    try {
      responseBody = await response.json();
    } catch (e) {
      /* empty */
    }

    runInAction(() => (this.hasAPIError = false));

    if ('code' in responseBody) {
      return Result.createErr(responseBody);
    }

    return Result.createOk({
      payload: responseBody.payload,
      headers: response.headers,
    });
  }

  @action
  private processAccessToken(accessToken: string) {
    try {
      const tokenData = JSON.parse(atob(accessToken.split('.')[1]));
      this.accessToken = accessToken;
      this.authUser = {
        id: tokenData.id,
        // TODO(kian): Add actual name to user object
        name: tokenData.id,
        isAdmin: tokenData.isAdmin,
      };
    } catch (e) {
      console.log('Failed to parse access token. Logging out.');
      this.logout();
    }
  }

  private async refreshToken(): Promise<Result<null>> {
    // Make sure only one promise to refresh the token is running at a time
    if (this.refreshTokenPromise === null) {
      this.refreshTokenPromise = fetchResource(
        this.apiUrl + '/users/login/refresh',
        'GET'
      )
        .then(response => {
          if (!response || response.status !== 200) {
            return Result.createErr({code: -1, message: 'Unauthorized'});
          }
          this.processAccessToken(Cookies.get('accessToken')!);

          return Result.createOk(null);
        })
        .finally(() => (this.refreshTokenPromise = null));
    }

    return this.refreshTokenPromise;
  }

  public logout() {
    // Make sure logout is only executed once
    if (!this.isLoggedIn) return;

    this.isLoggedIn = false;

    void fetchResource(this.apiUrl + '/users/logout', 'GET');
    // if (this.socket && this.socket.connected) {
    //   this.socket.disconnect();
    // }

    this.authUser = EMPTY_AUTH_USER;
  }

  @computed
  public get hasConnectionError() {
    return this.hasAPIError || this.hasSocketError;
  }

  @action
  private handleNetworkError(status: number | undefined) {
    if (!status || status === 503 || status === 504) {
      this.hasAPIError = true;
    } else if (status === 401) {
      this.logout();
    }
  }

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
