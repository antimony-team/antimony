import {
  APIRequestContext,
  APIResponse,
  expect,
  request,
} from '@playwright/test';
import {io} from 'socket.io-client';

import {ADMIN, BACKEND_URL, BASE_URL} from '../settings';

/*
 * A client for the Antimony REST API, used to set up test data directly instead of clicking through
 * the UI. It goes through the interface's /api proxy, exactly like the browser does. Deploying and
 * destroying labs only exists over Socket.IO, so those go to the server's /cmd namespace.
 */

type Payload<T> = {payload: T};

export type Credentials = {username: string; password: string};

export type CollectionOptions = {
  publicWrite?: boolean;
  publicDeploy?: boolean;
};

export type CollectionOut = {
  id: string;
  name: string;
  publicWrite: boolean;
  publicDeploy: boolean;
  creator: {id: string; name: string};
};

export type BindFileOut = {
  id: string;
  filePath: string;
  content: string;
  topologyId: string;
};

export type PolicyFinding = {
  ruleId: string;
  impact: string;
  path: string;
  message: string;
};

export type TopologyOut = {
  id: string;
  definition: string;
  annotations: string;
  syncUrl: string;
  collectionId: string;
  creator: {id: string; name: string};
  bindFiles: BindFileOut[];
  lastDeployFailed: boolean;
  // null when there are no findings
  policyFindings: PolicyFinding[] | null;
};

export enum InstanceState {
  Deploying = 0,
  Running = 1,
  Stopping = 2,
  Failed = 3,
}

export type LabOut = {
  id: string;
  name: string;
  startTime: string;
  endTime: string | null;
  topologyId: string | null;
  collectionId: string;
  creator: {id: string; name: string};
  // The copy of the topology the lab was created with, which it deploys
  topologyDefinition: string;
  instance: {
    name: string;
    state: InstanceState;
    nodes: {name: string; state: number}[];
  } | null;
};

export type LabOptions = {
  // Defaults to one hour from now, so the lab stays scheduled until a test deploys it
  startTime?: Date;
  // Defaults to two hours from now. null makes the lab run indefinitely.
  endTime?: Date | null;
};

// The runtime commands of the /cmd namespace
enum RuntimeCommand {
  DeployLab = 0,
  DestroyLab = 1,
}

/** A failed API call, with the status and the error the server answered with. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A topology of Linux nodes (host1 and host2 by default), connected in a chain over eth1, eth2, …
 * The name is taken from the definition, so every test passes its own unique name.
 */
export function topologyDefinition(
  name: string,
  nodes: string[] = ['host1', 'host2'],
  extraNodeLines = '',
): string {
  const nodeLines = nodes
    .map(
      node =>
        `    ${node}:\n      kind: linux\n      image: alpine:latest\n${extraNodeLines}`,
    )
    .join('');
  const links = nodes
    .slice(1)
    .map(
      (node, i) =>
        `    - endpoints: ["${nodes[i]}:eth${i === 0 ? 1 : 2}", "${node}:eth1"]\n`,
    )
    .join('');

  return (
    `name: ${name}\ntopology:\n  nodes:\n${nodeLines}` +
    (links ? `  links:\n${links}` : '')
  );
}

/** Annotations that place the nodes next to each other, as the graph editor would store them. */
export function nodeAnnotations(nodes: string[] = ['host1', 'host2']): string {
  return JSON.stringify({
    nodeAnnotations: nodes.map((id, i) => ({
      id,
      position: {x: 150 + i * 200, y: 300},
    })),
  });
}

export class AntimonyApi {
  private constructor(
    private readonly context: APIRequestContext,
    readonly username: string,
  ) {}

  /** Creates a client that is logged in with the given credentials. */
  static async login(credentials: Credentials): Promise<AntimonyApi> {
    const context = await request.newContext({baseURL: BASE_URL});
    const response = await context.post('/api/users/login/native', {
      data: credentials,
    });
    expect(response.ok(), `logging in as ${credentials.username}`).toBe(true);

    return new AntimonyApi(context, credentials.username);
  }

  static loginAsAdmin(): Promise<AntimonyApi> {
    return AntimonyApi.login(ADMIN);
  }

  async dispose() {
    await this.context.dispose();
  }

  /** The access token of this client, for Socket.IO and the Authorization header. */
  async accessToken(): Promise<string> {
    const {cookies} = await this.context.storageState();
    const token = cookies.find(cookie => cookie.name === 'accessToken')?.value;
    expect(token, 'the access token cookie').toBeTruthy();
    return token!;
  }

  // Collections

  async createCollection(
    name: string,
    options: CollectionOptions = {},
  ): Promise<string> {
    return this.call<string>('POST', '/collections', {
      name,
      publicWrite: options.publicWrite ?? false,
      publicDeploy: options.publicDeploy ?? false,
    });
  }

  async updateCollection(
    collectionId: string,
    update: Partial<{
      name: string;
      publicWrite: boolean;
      publicDeploy: boolean;
    }>,
  ) {
    await this.call('PATCH', `/collections/${collectionId}`, update);
  }

  async deleteCollection(collectionId: string) {
    await this.call('DELETE', `/collections/${collectionId}`);
  }

  async getCollections(): Promise<CollectionOut[]> {
    return this.call<CollectionOut[]>('GET', '/collections');
  }

  // Topologies and bind files

  async createTopology(
    collectionId: string,
    definition: string,
    annotations = '{}',
  ): Promise<string> {
    return this.call<string>('POST', '/topologies', {
      collectionId,
      definition,
      annotations,
      syncUrl: '',
    });
  }

  async updateTopology(
    topologyId: string,
    update: Partial<{
      definition: string;
      annotations: string;
      syncUrl: string;
      collectionId: string;
    }>,
  ) {
    await this.call('PATCH', `/topologies/${topologyId}`, update);
  }

  async deleteTopology(topologyId: string) {
    await this.call('DELETE', `/topologies/${topologyId}`);
  }

  async getTopologies(): Promise<TopologyOut[]> {
    return this.call<TopologyOut[]>('GET', '/topologies');
  }

  async getTopology(topologyId: string): Promise<TopologyOut> {
    return this.call<TopologyOut>('GET', `/topologies/${topologyId}`);
  }

  /** The parsed annotations of a topology as stored on the server. */
  async getAnnotations(topologyId: string): Promise<Annotations> {
    const {annotations} = await this.getTopology(topologyId);
    return JSON.parse(annotations || '{}') as Annotations;
  }

  async createBindFile(
    topologyId: string,
    filePath: string,
    content: string,
  ): Promise<string> {
    return this.call<string>('POST', `/topologies/${topologyId}/files`, {
      filePath,
      content,
    });
  }

  async updateBindFile(
    topologyId: string,
    bindFileId: string,
    update: Partial<{filePath: string; content: string}>,
  ) {
    await this.call(
      'PATCH',
      `/topologies/${topologyId}/files/${bindFileId}`,
      update,
    );
  }

  async deleteBindFile(topologyId: string, bindFileId: string) {
    await this.call('DELETE', `/topologies/${topologyId}/files/${bindFileId}`);
  }

  // Labs

  async createLab(
    topologyId: string,
    name: string,
    options: LabOptions = {},
  ): Promise<string> {
    const startTime =
      options.startTime ?? new Date(Date.now() + 60 * 60 * 1000);
    const endTime =
      options.endTime === undefined
        ? new Date(startTime.getTime() + 60 * 60 * 1000)
        : options.endTime;

    return this.call<string>('POST', '/labs', {
      name,
      topologyId,
      startTime: startTime.toISOString(),
      endTime: endTime?.toISOString() ?? null,
    });
  }

  async updateLab(
    labId: string,
    update: Partial<{
      name: string;
      startTime: string;
      endTime: string;
      indefinite: boolean;
    }>,
  ) {
    await this.call('PATCH', `/labs/${labId}`, update);
  }

  async deleteLab(labId: string) {
    await this.call('DELETE', `/labs/${labId}`);
  }

  /** All labs the user can see (without a limit, the server returns every lab). */
  async getLabs(): Promise<LabOut[]> {
    return this.call<LabOut[]>('GET', '/labs');
  }

  async getLab(labId: string): Promise<LabOut> {
    return this.call<LabOut>('GET', `/labs/${labId}`);
  }

  async findLab(name: string): Promise<LabOut | undefined> {
    return (await this.getLabs()).find(lab => lab.name === name);
  }

  /** Deploys a lab and waits until it runs. The dummy provider takes about a second. */
  async deployLab(labId: string) {
    await this.command(RuntimeCommand.DeployLab, labId);
    await this.waitForLab(
      labId,
      lab => lab.instance?.state === InstanceState.Running,
    );
  }

  /** Destroys a running lab and waits until it's gone. */
  async destroyLab(labId: string) {
    await this.command(RuntimeCommand.DestroyLab, labId);
    await this.waitForLab(labId, lab => lab.instance === null);
  }

  async waitForLab(labId: string, condition: (lab: LabOut) => boolean) {
    await expect
      .poll(async () => condition(await this.getLab(labId)), {
        message: `waiting for lab ${labId}`,
        timeout: 15_000,
      })
      .toBe(true);
  }

  // Users

  /** Creates a non-admin user with access to the given collections (the server must run with -dev). */
  async createUser(
    credentials: Credentials,
    collections: string[],
  ): Promise<string> {
    return this.call<string>('POST', '/users', {...credentials, collections});
  }

  // Raw access, for tests of what the server allows

  /** Sends a request and returns the response without checking it, for testing errors. */
  async raw(
    method: string,
    path: string,
    data?: unknown,
  ): Promise<APIResponse> {
    return this.context.fetch(`/api${path}`, {method, data});
  }

  /** Sends a request and returns its payload, or throws an ApiError with the server's error. */
  async call<T>(method: string, path: string, data?: unknown): Promise<T> {
    const response = await this.raw(method, path, data);
    const body = (await response.json().catch(() => ({}))) as Partial<
      Payload<T> & {code: number; message: string}
    >;

    if (!response.ok()) {
      throw new ApiError(
        response.status(),
        body.code,
        `${method} ${path} failed with ${response.status()}: ${JSON.stringify(body)}`,
      );
    }
    return body.payload as T;
  }

  /**
   * Sends a runtime command over Socket.IO and returns the acknowledgement, which is
   * {payload} or {code, message}.
   */
  async command(
    command: number,
    labId: string,
    extra: Record<string, unknown> = {},
  ): Promise<{payload?: unknown; code?: number; message?: string}> {
    const socket = io(`${BACKEND_URL}/cmd`, {
      auth: {token: await this.accessToken()},
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      return (await socket
        .timeout(15_000)
        .emitWithAck('data', JSON.stringify({command, labId, ...extra}))) as {
        payload?: unknown;
        code?: number;
        message?: string;
      };
    } finally {
      socket.disconnect();
    }
  }
}

export type Position = {x: number; y: number};

/** The annotations of a topology, as far as the tests look at them. */
export type Annotations = {
  nodeAnnotations?: {
    id: string;
    position?: Position;
    groupId?: string;
    icon?: string;
  }[];
  groupStyleAnnotations?: {
    id: string;
    name: string;
    parentId?: string;
    position: Position;
    width: number;
    height: number;
    zIndex?: number;
    [key: string]: unknown;
  }[];
  freeShapeAnnotations?: {
    id: string;
    shapeType: 'rectangle' | 'circle' | 'line';
    position: Position;
    endPosition?: Position;
    width?: number;
    height?: number;
    groupId?: string;
    zIndex?: number;
    [key: string]: unknown;
  }[];
  freeTextAnnotations?: {
    id: string;
    text: string;
    position: Position;
    groupId?: string;
    [key: string]: unknown;
  }[];
};
