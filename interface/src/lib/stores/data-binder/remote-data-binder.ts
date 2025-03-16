import Cookies from 'js-cookie';
import {io, Socket} from 'socket.io-client';
import {action, computed, observable, runInAction} from 'mobx';

import {fetchResource} from '@sb/lib/utils/utils';
import {DataBinder, DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {UserCredentials} from '@sb/types/types';
import {Result} from '@sb/types/result';

type AuthResponse = {
  token: string;
  isAdmin: boolean;
};

export class RemoteDataBinder extends DataBinder {
  private readonly apiUrl = process.env.SB_API_SERVER_URL ?? 'localhost';

  @observable accessor isAdmin = false;
  @observable accessor isLoggedIn = false;

  @observable accessor hasAPIError = false;
  @observable accessor hasSocketError = false;

  public socket: Socket = io();

  constructor() {
    super();

    const accessToken = Cookies.get('accessToken');
    if (accessToken !== undefined) {
      this.processAccessToken(accessToken);
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
      Cookies.set('isAdmin', String(this.isAdmin));
    }

    return true;
  }

  @action
  private processAccessToken(token: string) {
    try {
      const tokenData = JSON.parse(atob(token.split('.')[1]));
      this.isAdmin = tokenData.isAdmin;
      this.setupConnection();
    } catch (e) {
      console.log('Failed to parse access token. Logging out.');
      this.logout();
    }
  }

  private async refreshToken(): Promise<Result<null>> {
    const refreshResponse = await fetchResource(
      this.apiUrl + '/users/login/refresh',
      'GET'
    );

    if (!refreshResponse || refreshResponse.status !== 200) {
      if (Cookies.get('authOidc') === 'true') {
        window.location.replace(this.apiUrl + '/users/login/openid');
      }
    }

    this.processAccessToken(Cookies.get('accessToken')!);

    return Result.createOk(null);
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

    // if (isExternal) {
    //   return this.fetchExternal<R, T>(path, method, body);
    // }

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
      runInAction(() => (this.hasAPIError = true));
      this.logout();
      return Result.createErr({code: -1, message: 'Server Error'});
    }

    // Acecss token is expired, attempt to refresh before retrying
    if (response.status === 498) {
      const refreshResponse = await this.refreshToken();
      if (refreshResponse.isErr()) {
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

  public logout() {
    void this.get('/users/logout');

    if (this.socket && this.socket.connected) {
      this.socket.disconnect();
    }

    this.isAdmin = false;
    this.isLoggedIn = false;
  }

  @computed
  public get hasConnectionError() {
    return this.hasAPIError || this.hasSocketError;
  }

  @action
  private setupConnection() {
    this.isLoggedIn = true;
    // this.socket = io(window.location.host, {
    //   auth: {
    //     token: this.accessToken,
    //   },
    // });
    //
    // this.socket.on('connect_error', () => {
    //   runInAction(() => (this.hasSocketError = true));
    // });
    //
    // this.socket.on('connect', () => {
    //   runInAction(() => {
    //     this.hasSocketError = false;
    //     this.isLoggedIn = true;
    //   });
    // });
  }

  @action
  private handleNetworkError(status: number | undefined) {
    if (!status || status === 503 || status === 504) {
      this.hasAPIError = true;
    } else if (status === 401) {
      this.logout();
    }
  }
}
