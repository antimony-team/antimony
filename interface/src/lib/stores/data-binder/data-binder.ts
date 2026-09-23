import {fetchResource} from '@sb/lib/utils/utils';
import {
  AuthConfig,
  AuthenticatedUser,
  EMPTY_AUTH_USER,
} from '@sb/types/domain/user';
import {Result} from '@sb/types/result';
import {ConnectionState, UserCredentials} from '@sb/types/types';
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

// How long to wait before retrying a fetch request on network error
const FETCH_RETRY_TIMER = 5000;

// How long to wait before retrying a subscription if the namespace is invalid
const INVALID_NAMESPACE_RETRY_TIMER = 5000;

export class DataBinder {
  private readonly apiUrl =
    import.meta.env.SB_API_SERVER_URL ?? window.location.host;
  private readonly socketUrl =
    import.meta.env.SB_SOCKET_SERVER_URL ?? window.location.host;

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

  private runningRequests = new Map<string, number>();

  constructor() {
    /*
     * Automatically connect / disconnect subscriptions when logged in.
     *
     * Registered here rather than at the end of `initAuth` so that it is also
     * active on the code paths that log the user in and return early.
     */
    autorun(() => {
      if (this.isLoggedIn) {
        this.connectSubscriptions();
      } else {
        this.disconnectSubscriptions();
      }
    });

    void this.initAuth();
  }

  private async initAuth() {
    const authConfigResponse = await this.get<AuthConfig>(
      '/users/login/auth-config',
      false,
    );
    if (authConfigResponse.isErr()) {
      runInAction(() => (this.hasAPIError = true));

      /*
       * `fetch` only retries on network failures and gateway timeouts, so a
       * server-side error here would leave the client stuck on the connection
       * screen forever. Retry on our own to recover once the server is back.
       */
      setTimeout(() => void this.initAuth(), FETCH_RETRY_TIMER);
      return;
    }

    const authConfig = authConfigResponse.data.payload;
    runInAction(() => {
      this.isOpenIdAuthEnabled = authConfig.openId.enabled;
      this.isNativeAuthEnabled = authConfig.native.enabled;
      this.useNativeAutoLogin = authConfig.native.allowEmpty;
    });

    if (this.isAuthDisabled) {
      runInAction(() => {
        this.isLoggedIn = true;
        this.authUser = {
          id: '',
          isAdmin: true,
          name: 'Admin',
        };
      });
    } else if (Cookies.get('accessToken') !== undefined) {
      // If access token has been set previously, attempt to refresh token
      const refreshResult = await this.refreshToken();

      if (refreshResult.isOk()) {
        runInAction(() => (this.isLoggedIn = true));
      } else if (this.isOpenIdAuthEnabled && this.isAuthenticatedWithOidc) {
        /*
         * Redirect to OpenID login if existing auth token is invalid, auth via
         * OpenID is enabled, and the user has previously logged in via OpenID.
         */
        this.loginWithOpenId();
        return;
      }
    } else if (
      this.isNativeAuthEnabled &&
      authConfig.native.allowEmpty &&
      !authConfig.openId.enabled
    ) {
      await this.loginNative({
        username: '',
        password: '',
      });
    }

    runInAction(() => (this.isReady = true));
  }

  public get isAuthenticatedWithOidc() {
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

  @computed
  public get isAuthDisabled() {
    return !this.isOpenIdAuthEnabled && !this.isNativeAuthEnabled;
  }

  /**
   * Creates a socket and registers callbacks for a given subscription.
   * @param subscription
   * @private
   */
  private connectSubscription(subscription: Subscription) {
    if (subscription.isAnonymous) {
      try {
        subscription.socket = io(
          `${this.socketUrl}/${subscription.namespace}`,
          SOCKETIO_CONFIG,
        );
      } catch {
        subscription.socket?.close();
        return;
      }
    } else {
      try {
        subscription.socket = io(
          `${this.socketUrl}/${subscription.namespace}`,
          {
            ...SOCKETIO_CONFIG,
            auth: {
              token: this.accessToken,
            },
          },
        );
      } catch {
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
        void this.refreshToken().then(result => {
          if (result.isOk()) {
            // Retry socket subscription if token was refreshed successfully
            this.connectSubscription(subscription);
          } else {
            if (this.isOpenIdAuthEnabled && this.isAuthenticatedWithOidc) {
              this.loginWithOpenId();
            }
          }
        });

        return;
      }

      if (e.message === 'Invalid namespace') {
        console.warn(
          '[SOCK] Tried to connect to invalid namespace:',
          subscription.namespace,
        );

        subscription.socket?.disconnect();
        setTimeout(() => {
          subscription.socket?.connect();
        }, INVALID_NAMESPACE_RETRY_TIMER);

        return;
      }

      runInAction(() => (this.hasSocketError = true));
      console.error(
        '[SOCK] Socket Error:',
        e,
        'namespace:',
        subscription.namespace,
      );
    });

    subscription.socket.on('backlog', (data: unknown) => {
      const items = data instanceof ArrayBuffer ? [data] : (data as unknown[]);
      for (const msg of items) {
        subscription.onDataCallbacks.forEach(cb => cb(msg));
      }
    });

    subscription.socket.on('data', (data: unknown) => {
      subscription.onDataCallbacks.forEach(cb => cb(data));
    });

    // subscription.onDataCallbacks.forEach(callback => {
    //   subscription.socket!.on('backlog', data => {
    //     if (data instanceof ArrayBuffer) {
    //       callback(data);
    //     } else {
    //       for (const msg of data) callback(msg);
    //     }
    //   });
    //   subscription.socket!.on('data', callback);
    // });
  }

  /**
   * Subscribes to a socket.io namespace and optionally registers a callback.
   *
   * Directly connects to the namespace if the subscription is anonymous or the
   * user is already logged in.
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
    isAnonymous = false,
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
    onDisconnect?: () => void,
  ) {
    if (this.subscriptions.has(namespace)) {
      const subscription = this.subscriptions.get(namespace)!;
      // console.log('namespace callbacks: ', subscription.onDataCallbacks);
      //
      // console.log(
      //   'namespace callbacks has unsubscriber: ',
      //   subscription.onDataCallbacks.has(onData),
      // );
      //
      // console.log('unsubscriber: ', onData);

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
      false,
    );

    if (!tokenResponse.isOk()) {
      console.error(
        '[AUTH] Failed to login user with provided credentials. Aborting.',
      );
      return false;
    }

    const refreshResult = await this.refreshToken();
    if (refreshResult.isOk()) {
      runInAction(() => (this.isLoggedIn = true));
    }

    return true;
  }

  protected async fetch<R, T>(
    path: string,
    method: string,
    body?: R,
    authenticated = true,
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
      await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_TIMER));
      return this.fetch(path, method, body, authenticated);
    }

    if (response.status >= 500) {
      return Result.createErr({code: -1, message: 'Server Error'});
    }

    // Acecss token is expired, attempt to refresh before retrying
    if (response.status === 498) {
      const refreshResponse = await this.refreshToken();
      if (refreshResponse.isErr()) {
        if (this.isOpenIdAuthEnabled && this.isAuthenticatedWithOidc) {
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
    } catch {
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
        name: tokenData.id,
        isAdmin: tokenData.isAdmin,
      };
    } catch {
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
        'GET',
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
  public logout(reloadApp: boolean = false) {
    // Make sure logout is only executed once
    if (!this.isLoggedIn) return;

    void fetchResource(this.apiUrl + '/users/logout', 'POST');

    if (reloadApp) {
      window.location.reload();
    } else {
      this.isLoggedIn = false;
      this.hasSocketError = false;
      this.hasAPIError = false;
      this.authUser = EMPTY_AUTH_USER;
    }
  }

  /**
   * Whether the connection was interrupted after the user has already logged in.
   *
   * The app stays usable in that case, so this only drives the connection
   * banner rather than a full-screen takeover.
   */
  @computed
  public get connectionWasInterrupted() {
    return this.isLoggedIn && this.hasConnectionError;
  }

  @computed
  public get hasConnectionError() {
    return this.hasAPIError || this.hasSocketError;
  }

  @computed
  public get apiState(): ConnectionState {
    return this.hasAPIError ? ConnectionState.Retrying : ConnectionState.Ok;
  }

  @computed
  public get socketState(): ConnectionState {
    // The sockets are only connected once the user is logged in.
    if (!this.isLoggedIn) return ConnectionState.Unknown;

    return this.hasSocketError ? ConnectionState.Retrying : ConnectionState.Ok;
  }

  public async get<T>(
    path: string,
    authenticated = true,
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(path, 'GET', undefined, authenticated);
  }

  /**
   * Like get(), but if a newer getLatest() for the same path starts before this
   * one returns, this one resolves to null and its result must be discarded.
   */
  public async getLatest<T>(
    path: string,
    authenticated = true,
  ): Promise<Result<DataResponse<T>> | null> {
    const seq = (this.runningRequests.get(path) ?? 0) + 1;
    this.runningRequests.set(path, seq);

    const result = await this.get<T>(path, authenticated);

    return this.runningRequests.get(path) === seq ? result : null;
  }

  public async delete<T>(
    path: string,
    authenticated = true,
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<void, T>(path, 'DELETE', undefined, authenticated);
  }

  public async post<R, T>(
    path: string,
    body: R,
    authenticated = true,
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(path, 'POST', body, authenticated);
  }

  public async put<R, T>(
    path: string,
    body: R,
    authenticated = true,
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<R, T>(path, 'PUT', body, authenticated);
  }

  public async patch<R, T>(
    path: string,
    body: Partial<R>,
    authenticated = true,
  ): Promise<Result<DataResponse<T>>> {
    return this.fetch<Partial<R>, T>(path, 'PATCH', body, authenticated);
  }
}
