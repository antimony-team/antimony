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
  private authToken: string | null = null;

  @observable accessor isAdmin = false;
  @observable accessor isLoggedIn = false;

  @observable accessor hasAPIError = false;
  @observable accessor hasSocketError = false;
  @observable accessor hasExternalError = false;

  public socket: Socket = io();

  constructor() {
    super();

    if (Cookies.get('authToken') !== undefined) {
      this.setupConnection(
        Cookies.get('authToken')!,
        JSON.parse(Cookies.get('isAdmin') || 'false')
      );
    }
  }

  public async login(
    credentials: UserCredentials,
    saveCookie: boolean
  ): Promise<boolean> {
    const tokenResponse = await this.post<UserCredentials, AuthResponse>(
      '/users/auth',
      credentials,
      false,
      true
    );
    if (!tokenResponse.isOk()) {
      console.error(
        '[AUTH] Failed to login user with provided credentials. Aborting.'
      );
      return false;
    }

    this.setupConnection(
      tokenResponse.data.payload.token,
      tokenResponse.data.payload.isAdmin
    );

    if (saveCookie) {
      Cookies.set('authToken', this.authToken!);
      Cookies.set('isAdmin', String(this.isAdmin));
    }

    return true;
  }

  @action
  protected async fetch<R, T>(
    path: string,
    method: string,
    body?: R,
    isExternal = false,
    skipAuthentication = false
  ): Promise<Result<DataResponse<T>>> {
    if (!skipAuthentication && !isExternal && !this.isLoggedIn) {
      return Result.createErr({code: -1, message: 'Unauthorized'});
    }

    if (isExternal) {
      return this.fetchExternal<R, T>(path, method, body);
    }

    const response = await fetchResource(this.apiUrl + path, method, body, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.authToken}`,
    });

    if (!response || !response.ok) {
      this.handleNetworkError(response?.status);
      await new Promise(resolve => setTimeout(resolve, this.fetchRetryTimer));
      return this.fetch(path, method, body, false, skipAuthentication);
    }

    runInAction(() => (this.hasAPIError = false));

    const responseBody = await response.json();

    if ('code' in responseBody) {
      return Result.createErr(responseBody);
    }

    return Result.createOk({
      payload: responseBody.payload,
      headers: response.headers,
    });
  }

  public logout() {
    Cookies.remove('authToken');
    Cookies.remove('isAdmin');

    if (this.socket && this.socket.connected) {
      this.socket.disconnect();
    }

    this.authToken = null;
    this.isAdmin = false;
    this.isLoggedIn = false;
  }

  @computed
  public get hasConnectionError() {
    return this.hasExternalError || this.hasAPIError || this.hasSocketError;
  }

  @action
  private setupConnection(token: string, isAdmin: boolean) {
    this.authToken = token;
    this.isAdmin = isAdmin;

    this.socket = io(window.location.host, {
      auth: {
        token: this.authToken,
      },
    });

    this.socket.on('connect_error', () => {
      runInAction(() => (this.hasSocketError = true));
    });

    this.socket.on('connect', () => {
      runInAction(() => {
        this.hasSocketError = false;
        this.isLoggedIn = true;
      });
    });
  }

  @action
  private handleNetworkError(status: number | undefined) {
    if (!status || status === 503 || status === 504) {
      this.hasAPIError = true;
    } else if (status === 403) {
      this.logout();
    }
  }
}
