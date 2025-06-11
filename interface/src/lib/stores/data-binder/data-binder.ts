import {fetchResource} from '@sb/lib/utils/utils';
import {
  AuthConfig,
  AuthenticatedUser,
  EMPTY_AUTH_USER,
} from '@sb/types/domain/user';
import {Result} from '@sb/types/result';
import {UserCredentials} from '@sb/types/types';
import Cookies from 'js-cookie';
import {action, autorun, computed, observable, runInAction} from 'mobx';
import {io, Socket} from 'socket.io-client';

type AuthResponse = {
  token: string;
  isAdmin: boolean;
};

export type DataResponse<T> = {
  payload: T;
  headers?: Headers;
};

export type SubscriptionCallback = (data: unknown) => void;

export type Subscription = {
  socket?: Socket;
  namespace: string;
  onDataCallbacks: Set<SubscriptionCallback>;
  onConnectCallbacks: Set<() => void>;
  onDisconnectCallbacks: Set<() => void>;
  isAnonymous: boolean;
};

const SOCKETIO_CONFIG = {
  transports: ['websocket'],
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

  @observable accessor isOpenIdAuthEnabled = false;

  @observable accessor isNativeAuthEnabled = false;
  @observable accessor useNativeAutoLogin = false;

  private refreshTokenPromise: Promise<Result<null>> | null = null;
  private accessToken: string = '';

  private subscriptions: Map<string, Subscription> = new Map();

  constructor() {
    void this.initAuth();
  }

  @action
  private async initAuth() {
    const authConfigResponse = await this.get<AuthConfig>(
      '/users/login/config',
      false
    );
    if (authConfigResponse.isErr()) return;

    const authConfig = authConfigResponse.data.payload;
    this.isOpenIdAuthEnabled = authConfig.openId.enabled;
    this.isNativeAuthEnabled = authConfig.native.enabled;
    this.useNativeAutoLogin = authConfig.native.allowEmpty;

    if (Cookies.get('accessToken') !== undefined) {
      // If access token has been set previously, attempt to refresh token
      const refreshResult = await this.refreshToken();

      if (refreshResult.isOk()) {
        runInAction(() => (this.isLoggedIn = true));
      } else if (this.isOpenIdAuthEnabled && this.isAuthenticatedWithOidc()) {
        /*
         * Redirect to OpenID login if existing auth token is invalid, auth via
         * OpenID is enabled, and the user has previously logged in via OpenID.
         */
        this.loginWithOpenId();
        return;
      }
    } else {
      if (
        this.isNativeAuthEnabled &&
        authConfig.native.allowEmpty &&
        !authConfig.openId.enabled
      ) {
        await this.loginNative({
          username: '',
          password: '',
        });
      }
    }

    // Automatically connect / disconnect subscriptions when logged in
    autorun(() => {
      if (this.isLoggedIn) {
        this.connectSubscriptions();
      } else {
        this.disconnectSubscriptions();
      }
    });

    runInAction(() => (this.isReady = true));
  }

  public isAuthenticatedWithOidc(): boolean {
    return Cookies.get('authOidc') === 'true';
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
      try {
        subscription.socket = io(`/${subscription.namespace}`, SOCKETIO_CONFIG);
      } catch (_) {
        subscription.socket?.close();
        return;
      }
    } else {
      try {
        subscription.socket = io(`/${subscription.namespace}`, {
          ...SOCKETIO_CONFIG,
          auth: {
            token: this.accessToken,
          },
        });
      } catch (_) {
        subscription.socket?.close();
        return;
      }
    }

    subscription.socket.on('connect', () => {
      console.log(`[SOCK] Connected to ns ${subscription.namespace}`);
      runInAction(() => (this.hasSocketError = false));

      subscription.onConnectCallbacks.forEach(callback => callback());
    });

    subscription.socket.on('disconnect', () => {
      console.log(`[SOCK] Disconnected from ns ${subscription.namespace}`);

      subscription.onDisconnectCallbacks.forEach(callback => callback());
    });

    subscription.socket.on('connect_error', e => {
      if (e.message === 'Invalid Token') {
        this.refreshToken().then(result => {
          if (result.isOk()) {
            // Retry socket subscription if token was refreshed successfully
            this.connectSubscription(subscription);
          } else {
            if (this.isOpenIdAuthEnabled && this.isAuthenticatedWithOidc()) {
              this.loginWithOpenId();
            }
          }
        });

        return;
      }

      runInAction(() => (this.hasSocketError = true));

      if (e.message === 'Invalid namespace') {
        subscription.socket?.disconnect();
        setTimeout(() => {
          subscription.socket?.connect();
        }, 2000);

        return;
      }

      console.error('Socket Error:', e, 'namespace:', subscription.namespace);
    });

    subscription.onDataCallbacks.forEach(callback => {
      subscription.socket!.on('backlog', data => {
        for (const msg of data) callback(msg);
      });
      subscription.socket!.on('data', callback);
    });
  }

  /**
   * Subscribes to a socket.io namespace and optionally registers a callback.
   *
   * Directly connects to the namespace if subscription is anonymous or the user
   * is already logged in.
   * @param namespace The name of the namespace.
   * @param onData Optional callback that is called when data is received from the namespace.
   * @param onConnect  Optional callback that is called when the connection is established.
   * @param onDisconnect  Optional callback that is called when the connection is closed.
   * @param isAnonymous Whether to connect to the socket regardless of authentication state.
   * @return The created subscription.
   */
  public subscribeNamespace<T>(
    namespace: string,
    onData?: (data: T) => void,
    onConnect?: () => void,
    onDisconnect?: () => void,
    isAnonymous = false
  ): Subscription {
    const onDataGeneric = onData as (data: unknown) => void | unknown;

    if (this.subscriptions.has(namespace)) {
      const subscription = this.subscriptions.get(namespace)!;

      // Add callback to subscription only if it's not already registered
      if (onDataGeneric && !subscription.onDataCallbacks.has(onDataGeneric)) {
        subscription.onDataCallbacks.add(onDataGeneric);
      }

      if (onConnect && !subscription.onConnectCallbacks.has(onConnect)) {
        subscription.onConnectCallbacks.add(onConnect);
      }

      if (
        onDisconnect &&
        !subscription.onDisconnectCallbacks.has(onDisconnect)
      ) {
        subscription.onDisconnectCallbacks.add(onDisconnect);
      }

      return subscription;
    } else {
      const subscription: Subscription = {
        namespace: namespace,
        onDataCallbacks: onDataGeneric
          ? new Set([onDataGeneric])
          : new Set<SubscriptionCallback>(),
        onConnectCallbacks: onConnect
          ? new Set([onConnect])
          : new Set<() => void>(),
        onDisconnectCallbacks: onDisconnect
          ? new Set([onDisconnect])
          : new Set<() => void>(),
        isAnonymous: isAnonymous,
      };
      this.subscriptions.set(namespace, subscription);

      if (this.isLoggedIn || isAnonymous) {
        this.connectSubscription(subscription);
      }

      return subscription;
    }
  }

  /**
   * Unsubscribes a callback from a namespace.
   *
   * @param namespace The name of the namespace.
   * @param onData The callback that is called when data is received from the namespace.
   * @param onConnect  Optional callback that is called when the connection is established.
   * @param onDisconnect  Optional callback that is called when the connection is closed.
   */
  public unsubscribeNamespace<T>(
    namespace: string,
    onData: (data: T) => void,
    onConnect?: () => void,
    onDisconnect?: () => void
  ) {
    if (this.subscriptions.has(namespace)) {
      const subscription = this.subscriptions.get(namespace)!;
      subscription.onDataCallbacks.delete(onData as (data: unknown) => void);
      if (onConnect) subscription.onConnectCallbacks.delete(onConnect);
      if (onDisconnect) subscription.onDisconnectCallbacks.delete(onDisconnect);

      if (subscription.onDataCallbacks.size === 0) {
        subscription.socket?.close();
        this.subscriptions.delete(namespace);
      }
    }
  }

  public loginWithOpenId() {
    window.location.href = this.apiUrl + '/users/login/openid';
  }

  public async loginNative(credentials: UserCredentials): Promise<boolean> {
    const tokenResponse = await this.post<UserCredentials, AuthResponse>(
      '/users/login/native',
      credentials,
      false
    );

    if (!tokenResponse.isOk()) {
      console.error(
        '[AUTH] Failed to login user with provided credentials. Aborting.'
      );
      return false;
    }

    runInAction(() => (this.isLoggedIn = true));

    return true;
  }

  protected async fetch<R, T>(
    path: string,
    method: string,
    body?: R,
    authenticated = true
  ): Promise<Result<DataResponse<T>>> {
    // If the request is authenticated, wait until the user is logged in
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

    if (response.status >= 500) {
      return Result.createErr({code: -1, message: 'Server Error'});
    }

    // Acecss token is expired, attempt to refresh before retrying
    if (response.status === 498) {
      const refreshResponse = await this.refreshToken();
      if (refreshResponse.isErr()) {
        if (this.isOpenIdAuthEnabled && this.isAuthenticatedWithOidc()) {
          this.loginWithOpenId();
          return refreshResponse;
        } else if (this.isNativeAuthEnabled && this.useNativeAutoLogin) {
          await this.loginNative({
            username: '',
            password: '',
          });
        } else {
          this.logout();
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

    if (!('payload' in responseBody)) {
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
      console.error('Failed to parse access token. Logging out.');
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

  @action
  public logout() {
    // Make sure logout is only executed once
    if (!this.isLoggedIn) return;

    this.isLoggedIn = false;
    this.hasSocketError = false;
    this.hasAPIError = false;

    void fetchResource(this.apiUrl + '/users/logout', 'POST');
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
    authenticated = true
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(path, 'GET', undefined, authenticated);
  }

  public async delete<T>(
    path: string,
    authenticated = true
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(path, 'DELETE', undefined, authenticated);
  }

  public async post<R, T>(
    path: string,
    body: R,
    authenticated = true
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(path, 'POST', body, authenticated);
  }

  public async put<R, T>(
    path: string,
    body: R,
    authenticated = true
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(path, 'PUT', body, authenticated);
  }

  public async patch<R, T>(
    path: string,
    body: Partial<R>,
    authenticated = true
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<Partial<R>, T>(path, 'PATCH', body, authenticated);
  }
}
