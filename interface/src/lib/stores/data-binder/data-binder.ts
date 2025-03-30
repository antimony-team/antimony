import {AuthenticatedUser, EMPTY_AUTH_USER} from '@sb/types/domain/user';
import Cookies from 'js-cookie';
import {io, Socket} from 'socket.io-client';
import {action, autorun, computed, observable, runInAction} from 'mobx';

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

type Subscription = {
  socket?: Socket;
  namespace: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  callbacks: Set<(data: unknown) => void>;
  isAnonymous: boolean;
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

  private subscriptions: Map<string, Subscription> = new Map();

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

    // Automatically connect / disconnect subscriptions when logged in
    autorun(() => {
      if (this.isLoggedIn) {
        this.connectSubscriptions();
      } else {
        this.disconnectSubscriptions();
      }
    });
  }

  private connectSubscriptions() {
    for (const [, subscription] of this.subscriptions) {
      this.connectSubscription(subscription);
    }
  }

  private disconnectSubscriptions() {
    for (const [, subscription] of this.subscriptions) {
      subscription.socket?.close();
    }
  }

  /**
   * Creates a socket and registers callbacks for a given subscription.
   * @param subscription
   * @private
   */
  private connectSubscription(subscription: Subscription) {
    if (subscription.isAnonymous) {
      subscription.socket = io(`/${subscription.namespace}`);
    } else {
      subscription.socket = io(`/${subscription.namespace}`, {
        auth: {
          token: this.accessToken,
        },
      });
    }

    subscription.socket.on('connect', () => {
      console.log(`[SOCK] Connected to ns ${subscription.namespace}`);
    });

    subscription.socket.on('disconnect', () => {
      console.log(`[SOCK] Disconnected from ns ${subscription.namespace}`);
    });

    subscription.socket.on('connect_error', e => {
      if (e.message === 'Invalid namespace') {
        subscription.socket?.disconnect();
        setTimeout(() => {
          subscription.socket?.connect();
        }, 2000);
      } else if (e.message === 'Invalid Token') {
        this.refreshToken().then(result => {
          if (result.isOk()) {
            // Retry socket subscription if token was refreshed successfully
            this.connectSubscription(subscription);
          }
        });
      }
    });

    subscription.callbacks.forEach(callback => {
      subscription.socket!.on('backlog', data => {
        for (const msg of data) callback(msg);
      });
      subscription.socket!.on('data', callback);
    });
  }

  /**
   * Subscribes a callback to a socket.io namespace.
   *
   * Directly connects to the namespace if subscription is anonymous or the user
   * is already logged in.
   * @param namespace The name of the namespace.
   * @param onData The callback that is called when data is received from the namespace.
   * @param isAnonymous Whether to connect to the socket regardless of authentication state.
   */
  public subscribeNamespace<T>(
    namespace: string,
    onData: (data: T) => void,
    isAnonymous = false
  ) {
    const onDataGeneric = onData as (data: unknown) => void;

    if (this.subscriptions.has(namespace)) {
      const subscription = this.subscriptions.get(namespace)!;

      // Add callback to subscription only if it's not already registered
      if (!subscription.callbacks.has(onDataGeneric)) {
        subscription.callbacks.add(onDataGeneric);
      }
    } else {
      const subscription = {
        namespace: namespace,
        callbacks: new Set([onData as (data: unknown) => void]),
        isAnonymous: isAnonymous,
      };
      this.subscriptions.set(namespace, subscription);

      if (this.isLoggedIn || isAnonymous) {
        this.connectSubscription(subscription);
      }
    }
  }

  /**
   * Unsubscribes a callback from a namespace.
   *
   * @param namespace The name of the namespace.
   * @param onData The callback that is called when data is received from the namespace.
   */
  public unsubscribeNamespace<T>(namespace: string, onData: (data: T) => void) {
    if (this.subscriptions.has(namespace)) {
      const subscription = this.subscriptions.get(namespace)!;
      subscription.callbacks.delete(onData as (data: unknown) => void);

      if (subscription.callbacks.size === 0) {
        subscription.socket?.close();
        this.subscriptions.delete(namespace);
      }
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

  /**
   * Sets the auth user based on the access token.
   */
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

  /**
   * Refreshes the access token for the Antimony API.
   *
   * @returns Ok<null> if the refreshing was successful.
   */
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
