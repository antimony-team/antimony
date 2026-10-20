import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DataBinder} from '@sb/lib/stores/data-binder/data-binder';
import {EMPTY_AUTH_USER} from '@sb/types/domain/user';
import {ConnectionState} from '@sb/types/types';

const {sockets, FakeSocket} = vi.hoisted(() => {
  class FakeSocket {
    public handlers = new Map<string, (data?: unknown) => void>();
    public closed = false;

    constructor(
      public url: string,
      public options: {auth?: {token: string}},
    ) {}

    public on(event: string, handler: (data?: unknown) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    public receive(event: string, data?: unknown) {
      this.handlers.get(event)?.(data);
    }

    public close() {
      this.closed = true;
    }

    public connect() {}

    public disconnect() {}
  }

  return {sockets: [] as FakeSocket[], FakeSocket};
});

vi.mock('socket.io-client', () => ({
  io: (url: string, options: {auth?: {token: string}}) => {
    const socket = new FakeSocket(url, options);
    sockets.push(socket);
    return socket;
  },
}));

type Handler = (init: RequestInit) => Response | Promise<Response>;

function token(id: string, isAdmin = false) {
  return `header.${btoa(JSON.stringify({id, isAdmin}))}.signature`;
}

function json(status: number, body?: unknown, headers?: HeadersInit) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

// Answers with the given responses in order and repeats the last one
function sequence(...responses: Handler[]): Handler {
  return init =>
    (responses.length > 1 ? responses.shift()! : responses[0])(init);
}

describe('DataBinder', () => {
  let routes: Map<string, Handler>;
  let requests: string[];
  let bodies: Map<string, unknown>;
  let headers: Map<string, HeadersInit | undefined>;
  let cookies: Record<string, string>;
  let location: {origin: string; href: string};
  let desktop:
    | {config: () => Promise<{serverUrl: string; token: string}>}
    | undefined;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sockets.length = 0;

    requests = [];
    bodies = new Map();
    headers = new Map();
    cookies = {};
    location = {
      origin: 'http://localhost:8100',
      href: 'http://localhost:8100/',
    };
    desktop = undefined;

    routes = new Map<string, Handler>([
      [
        'GET /api/users/login/auth-config',
        () => json(200, {payload: {methods: ['admin']}}),
      ],
      ['GET /api/users/login/refresh', () => json(200)],
      ['POST /api/users/logout', () => json(200)],
    ]);

    vi.stubGlobal('window', {
      location,
      get antimonyDesktop() {
        return desktop;
      },
    });
    vi.stubGlobal('document', {
      get cookie() {
        return Object.entries(cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const request = `${init.method} ${url}`;
        requests.push(request);
        bodies.set(request, init.body && JSON.parse(init.body as string));
        headers.set(request, init.headers);

        const handler = routes.get(request);
        if (!handler) return json(404, {code: 404, message: 'Not found'});

        return handler(init);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function waitUntilReady(binder: DataBinder) {
    await vi.waitFor(() => expect(binder.isReady).toBe(true));
  }

  async function createBinder(loggedIn = false) {
    if (loggedIn) cookies.accessToken = token('alice');

    const binder = new DataBinder();
    await waitUntilReady(binder);
    expect(binder.isLoggedIn).toBe(loggedIn);
    requests.length = 0;

    return binder;
  }

  function count(request: string) {
    return requests.filter(r => r === request).length;
  }

  describe('authentication', () => {
    it('stays logged out without an access token', async () => {
      const binder = new DataBinder();
      await waitUntilReady(binder);

      expect(binder.isLoggedIn).toBe(false);
      expect(binder.authMethods).toEqual(['admin']);
      expect(binder.isAdminAuthEnabled).toBe(true);
      expect(binder.isOpenIdAuthEnabled).toBe(false);
      expect(requests).toEqual(['GET /api/users/login/auth-config']);
    });

    it('logs in with an existing access token and reads the user from it', async () => {
      cookies.accessToken = token('alice', true);
      const binder = new DataBinder();
      await waitUntilReady(binder);

      expect(binder.isLoggedIn).toBe(true);
      expect(binder.authUser).toEqual({
        id: 'alice',
        name: 'alice',
        isAdmin: true,
      });
      expect(requests).toEqual([
        'GET /api/users/login/auth-config',
        'GET /api/users/login/refresh',
      ]);
    });

    it('stays logged out if the existing access token cannot be refreshed', async () => {
      cookies.accessToken = token('alice');
      routes.set('GET /api/users/login/refresh', () => json(401));
      const binder = new DataBinder();
      await waitUntilReady(binder);

      expect(binder.isLoggedIn).toBe(false);
      expect(binder.authUser).toEqual(EMPTY_AUTH_USER);
    });

    it('redirects OpenID users to the OpenID login if their token cannot be refreshed', async () => {
      cookies.accessToken = token('alice');
      cookies.authOidc = 'true';
      routes.set('GET /api/users/login/auth-config', () =>
        json(200, {payload: {methods: ['openid']}}),
      );
      routes.set('GET /api/users/login/refresh', () => json(401));
      const binder = new DataBinder();

      await vi.waitFor(() =>
        expect(location.href).toBe('/api/users/login/openid'),
      );
      expect(binder.isReady).toBe(false);
    });

    // Bug: processAccessToken only logs out, so refreshFromCookie still reports success
    it.fails(
      'does not log in with an access token it cannot read',
      async () => {
        cookies.accessToken = 'broken';
        const binder = new DataBinder();
        await waitUntilReady(binder);

        expect(binder.isLoggedIn).toBe(false);
      },
    );

    it('retries reading the auth config until the server answers', async () => {
      vi.useFakeTimers();
      routes.set(
        'GET /api/users/login/auth-config',
        sequence(
          () => json(500),
          () => json(200, {payload: {methods: ['admin']}}),
        ),
      );
      const binder = new DataBinder();

      await vi.waitFor(() => expect(binder.hasAPIError).toBe(true));
      expect(binder.isReady).toBe(false);

      await vi.advanceTimersByTimeAsync(5000);
      await waitUntilReady(binder);
      expect(binder.hasAPIError).toBe(false);
      expect(binder.hasConnectionError).toBe(false);
    });

    it('logs in with credentials and refreshes the token', async () => {
      const binder = await createBinder();
      routes.set('POST /api/users/login/native', () => {
        cookies.accessToken = token('alice');
        return json(200, {payload: null});
      });

      const credentials = {username: 'alice', password: 'secret'};
      expect(await binder.loginNative(credentials)).toBe(true);
      expect(binder.isLoggedIn).toBe(true);
      expect(binder.authUser.id).toBe('alice');
      expect(requests).toEqual([
        'POST /api/users/login/native',
        'GET /api/users/login/refresh',
      ]);
      expect(bodies.get('POST /api/users/login/native')).toEqual(credentials);
    });

    it('does not log in with wrong credentials', async () => {
      const binder = await createBinder();
      routes.set('POST /api/users/login/native', () =>
        json(400, {code: 1001, message: 'Invalid credentials'}),
      );

      expect(
        await binder.loginNative({username: 'alice', password: 'wrong'}),
      ).toBe(false);
      expect(binder.isLoggedIn).toBe(false);
      expect(requests).toEqual(['POST /api/users/login/native']);
    });

    it('logs out and forgets the user', async () => {
      const binder = await createBinder(true);
      await binder.logout();

      expect(binder.isLoggedIn).toBe(false);
      expect(binder.authUser).toEqual(EMPTY_AUTH_USER);
      expect(requests).toEqual(['POST /api/users/logout']);
    });

    it('does not log out again once logged out', async () => {
      const binder = await createBinder(true);
      await binder.logout();
      await binder.logout();

      expect(count('POST /api/users/logout')).toBe(1);
    });

    it('logs the desktop app in with its token and sends the access token as a header', async () => {
      desktop = {
        config: async () => ({
          serverUrl: 'http://127.0.0.1:9000',
          token: 'desktop-token',
        }),
      };
      routes.set('GET http://127.0.0.1:9000/users/login/auth-config', () =>
        json(200, {payload: {methods: []}}),
      );
      routes.set('POST http://127.0.0.1:9000/users/login/desktop', () =>
        json(200, {payload: token('desktop')}),
      );
      routes.set('GET http://127.0.0.1:9000/labs', () =>
        json(200, {payload: []}),
      );
      const binder = new DataBinder();
      await waitUntilReady(binder);

      expect(binder.isDesktop).toBe(true);
      expect(binder.isLoggedIn).toBe(true);
      expect(binder.authUser.id).toBe('desktop');
      expect(binder.serverHost).toBe('127.0.0.1');
      expect(
        bodies.get('POST http://127.0.0.1:9000/users/login/desktop'),
      ).toEqual({token: 'desktop-token'});

      await binder.get('/labs');
      expect(headers.get('GET http://127.0.0.1:9000/labs')).toMatchObject({
        Authorization: `Bearer ${token('desktop')}`,
      });
    });

    it('does not log the desktop app in if its token is rejected', async () => {
      desktop = {
        config: async () => ({
          serverUrl: 'http://127.0.0.1:9000',
          token: 'desktop-token',
        }),
      };
      routes.set('GET http://127.0.0.1:9000/users/login/auth-config', () =>
        json(200, {payload: {methods: []}}),
      );
      routes.set('POST http://127.0.0.1:9000/users/login/desktop', () =>
        json(401),
      );
      const binder = new DataBinder();
      await waitUntilReady(binder);

      expect(binder.isLoggedIn).toBe(false);
    });

    it('takes the server host from the page in web builds', async () => {
      const binder = await createBinder();

      expect(binder.isDesktop).toBe(false);
      expect(binder.serverHost).toBe('localhost');
    });
  });

  describe('requests', () => {
    it('does not send authenticated requests while logged out', async () => {
      const binder = await createBinder();
      const result = await binder.get('/labs');

      expect(result.isErr() && result.error).toEqual({
        code: -1,
        message: 'Unauthorized',
      });
      expect(requests).toEqual([]);
    });

    it('sends unauthenticated requests while logged out', async () => {
      const binder = await createBinder();
      routes.set('GET /api/labs', () => json(200, {payload: ['lab']}));

      const result = await binder.get('/labs', false);
      expect(result.isOk() && result.data.payload).toEqual(['lab']);
    });

    it('returns the payload and headers of a response', async () => {
      const binder = await createBinder(true);
      routes.set('GET /api/labs', () =>
        json(200, {payload: ['lab']}, {'X-Total-Count': '1'}),
      );

      const result = await binder.get<string[]>('/labs');
      expect(result.isOk()).toBe(true);
      expect(result.data.payload).toEqual(['lab']);
      expect(result.data.headers?.get('X-Total-Count')).toBe('1');
    });

    it('returns the error the server responds with', async () => {
      const binder = await createBinder(true);
      routes.set('POST /api/topologies', () =>
        json(400, {code: 3001, message: 'Topology already exists'}),
      );

      const result = await binder.post('/topologies', {name: 'lab'});
      expect(result.isErr() && result.error).toEqual({
        code: 3001,
        message: 'Topology already exists',
      });
    });

    it('returns an empty payload for a response without a body', async () => {
      const binder = await createBinder(true);
      routes.set('DELETE /api/labs/a', () => json(204));

      const result = await binder.delete('/labs/a');
      expect(result.isOk() && result.data.payload).toEqual({});
    });

    it('returns a server error for server side failures', async () => {
      const binder = await createBinder(true);
      routes.set('GET /api/labs', () => json(500, {payload: []}));

      const result = await binder.get('/labs');
      expect(result.isErr() && result.error).toEqual({
        code: -1,
        message: 'Server error',
      });
    });

    it('sends the body as JSON with the method of the request', async () => {
      const binder = await createBinder(true);
      for (const method of ['POST', 'PUT', 'PATCH']) {
        routes.set(`${method} /api/labs/a`, () => json(200, {payload: null}));
      }

      await binder.post('/labs/a', {name: 'post'});
      await binder.put('/labs/a', {name: 'put'});
      await binder.patch('/labs/a', {name: 'patch'});

      expect(requests).toEqual([
        'POST /api/labs/a',
        'PUT /api/labs/a',
        'PATCH /api/labs/a',
      ]);
      expect(bodies.get('PATCH /api/labs/a')).toEqual({name: 'patch'});
      expect(headers.get('POST /api/labs/a')).toEqual({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
    });

    it('logs out when a request is unauthorized', async () => {
      const binder = await createBinder(true);
      routes.set('GET /api/labs', () => json(401));

      const result = await binder.get('/labs');
      expect(result.isErr() && result.error.message).toBe(
        'Unauthorized request.',
      );
      await vi.waitFor(() => expect(binder.isLoggedIn).toBe(false));
      expect(count('GET /api/users/login/refresh')).toBe(0);
    });

    it('retries a request until the server is reachable again', async () => {
      const binder = await createBinder(true);
      vi.useFakeTimers();
      routes.set(
        'GET /api/labs',
        sequence(
          () => Promise.reject(new TypeError('Failed to fetch')),
          () => json(504),
          () => json(200, {payload: ['lab']}),
        ),
      );

      const result = binder.get('/labs');
      await vi.advanceTimersByTimeAsync(0);
      expect(binder.hasAPIError).toBe(true);
      expect(binder.connectionWasInterrupted).toBe(true);

      await vi.advanceTimersByTimeAsync(10000);
      expect((await result).isOk()).toBe(true);
      expect(count('GET /api/labs')).toBe(3);
      expect(binder.hasAPIError).toBe(false);
    });
  });

  describe('token refresh', () => {
    it('refreshes an expired access token and retries the request', async () => {
      const binder = await createBinder(true);
      routes.set(
        'GET /api/labs',
        sequence(
          () => json(498),
          () => json(200, {payload: ['lab']}),
        ),
      );
      routes.set('GET /api/users/login/refresh', () => {
        cookies.accessToken = token('alice', true);
        return json(200);
      });

      const result = await binder.get('/labs');
      expect(result.isOk() && result.data.payload).toEqual(['lab']);
      expect(requests).toEqual([
        'GET /api/labs',
        'GET /api/users/login/refresh',
        'GET /api/labs',
      ]);
      expect(binder.authUser.isAdmin).toBe(true);
    });

    it('refreshes the token only once for parallel requests', async () => {
      const binder = await createBinder(true);
      let finishRefresh = () => {};
      routes.set(
        'GET /api/users/login/refresh',
        () =>
          new Promise(resolve => {
            finishRefresh = () => resolve(json(200));
          }),
      );
      routes.set(
        'GET /api/labs',
        sequence(
          () => json(498),
          () => json(498),
          () => json(200, {payload: ['lab']}),
        ),
      );

      const results = Promise.all([binder.get('/labs'), binder.get('/labs')]);
      await vi.waitFor(() => {
        expect(count('GET /api/labs')).toBe(2);
        expect(count('GET /api/users/login/refresh')).toBe(1);
      });
      finishRefresh();

      expect((await results).map(result => result.isOk())).toEqual([
        true,
        true,
      ]);
      expect(count('GET /api/users/login/refresh')).toBe(1);
      expect(count('GET /api/labs')).toBe(4);
    });

    it('refreshes the token again once the previous refresh finished', async () => {
      const binder = await createBinder(true);
      routes.set(
        'GET /api/labs',
        sequence(
          () => json(498),
          () => json(200, {payload: []}),
          () => json(498),
          () => json(200, {payload: []}),
        ),
      );

      await binder.get('/labs');
      await binder.get('/labs');
      expect(count('GET /api/users/login/refresh')).toBe(2);
    });

    it('logs out if the expired access token cannot be refreshed', async () => {
      const binder = await createBinder(true);
      routes.set('GET /api/labs', () => json(498));
      routes.set('GET /api/users/login/refresh', () => json(401));

      const result = await binder.get('/labs');
      expect(result.isErr() && result.error.message).toBe('Unauthorized');
      await vi.waitFor(() => expect(binder.isLoggedIn).toBe(false));
      expect(count('GET /api/labs')).toBe(1);
      expect(count('POST /api/users/logout')).toBe(1);
    });

    it('logs out if the server cannot be reached for the refresh', async () => {
      const binder = await createBinder(true);
      routes.set('GET /api/labs', () => json(498));
      routes.set('GET /api/users/login/refresh', () =>
        Promise.reject(new TypeError('Failed to fetch')),
      );

      expect((await binder.get('/labs')).isErr()).toBe(true);
      await vi.waitFor(() => expect(binder.isLoggedIn).toBe(false));
    });

    it('sends OpenID users to the OpenID login if the token cannot be refreshed', async () => {
      cookies.authOidc = 'true';
      routes.set('GET /api/users/login/auth-config', () =>
        json(200, {payload: {methods: ['openid']}}),
      );
      const binder = await createBinder(true);
      routes.set('GET /api/labs', () => json(498));
      routes.set('GET /api/users/login/refresh', () => json(401));

      expect((await binder.get('/labs')).isErr()).toBe(true);
      expect(location.href).toBe('/api/users/login/openid');
      expect(count('POST /api/users/logout')).toBe(0);
    });
  });

  describe('subscriptions', () => {
    it('connects anonymous subscriptions right away and others once logged in', async () => {
      const binder = await createBinder();
      binder.subscribeNamespace(
        'status',
        undefined,
        undefined,
        undefined,
        true,
      );
      binder.subscribeNamespace('labs');

      expect(sockets.map(socket => socket.url)).toEqual([
        'http://localhost:8100/status',
      ]);

      routes.set('POST /api/users/login/native', () => {
        cookies.accessToken = token('alice');
        return json(200, {payload: null});
      });
      await binder.loginNative({username: 'alice', password: 'secret'});

      expect(sockets.map(socket => socket.url)).toContain(
        'http://localhost:8100/labs',
      );
      expect(sockets.at(-1)!.options.auth).toEqual({token: token('alice')});
    });

    it('passes data and backlogs to the callbacks of a namespace', async () => {
      const binder = await createBinder(true);
      const first = vi.fn();
      const second = vi.fn();
      binder.subscribeNamespace('labs', first);
      binder.subscribeNamespace('labs', second);

      expect(sockets).toHaveLength(1);
      sockets[0].receive('data', 'a');
      sockets[0].receive('backlog', ['b', 'c']);

      expect(first.mock.calls).toEqual([['a'], ['b'], ['c']]);
      expect(second.mock.calls).toEqual([['a'], ['b'], ['c']]);
    });

    it('calls the connect and disconnect callbacks and tracks socket errors', async () => {
      const binder = await createBinder(true);
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();
      binder.subscribeNamespace('labs', vi.fn(), onConnect, onDisconnect);

      sockets[0].receive('connect_error', new Error('Connection refused'));
      expect(binder.hasSocketError).toBe(true);
      expect(binder.socketState).toBe(ConnectionState.Retrying);

      sockets[0].receive('connect');
      sockets[0].receive('disconnect');
      expect(binder.socketState).toBe(ConnectionState.Ok);
      expect(onConnect).toHaveBeenCalledOnce();
      expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it('refreshes the token and reconnects after an invalid token error', async () => {
      const binder = await createBinder(true);
      binder.subscribeNamespace('labs', vi.fn());
      routes.set('GET /api/users/login/refresh', () => {
        cookies.accessToken = token('renewed');
        return json(200);
      });

      sockets[0].receive('connect_error', new Error('Invalid Token'));

      await vi.waitFor(() => expect(sockets).toHaveLength(2));
      expect(sockets[1].options.auth).toEqual({token: token('renewed')});
      expect(binder.hasSocketError).toBe(false);
    });

    it('closes the socket once the last callback unsubscribes', async () => {
      const binder = await createBinder(true);
      const first = vi.fn();
      const second = vi.fn();
      binder.subscribeNamespace('labs', first);
      binder.subscribeNamespace('labs', second);

      binder.unsubscribeNamespace('labs', first);
      expect(sockets[0].closed).toBe(false);

      binder.unsubscribeNamespace('labs', second);
      expect(sockets[0].closed).toBe(true);

      binder.subscribeNamespace('labs', first);
      expect(sockets).toHaveLength(2);
    });

    it('closes the sockets on logout', async () => {
      const binder = await createBinder(true);
      binder.subscribeNamespace('labs', vi.fn());
      await binder.logout();

      expect(sockets[0].closed).toBe(true);
    });
  });
});
