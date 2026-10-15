import {APIRequestContext, expect, request} from '@playwright/test';

import {ADMIN, BASE_URL} from '../settings';

/*
 * A client for the Antimony REST API, used to set up test data directly instead of clicking through
 * the UI. It goes through the interface's /api proxy, exactly like the browser does.
 */

type Payload<T> = {payload: T};

export type CollectionOptions = {
  publicWrite?: boolean;
  publicDeploy?: boolean;
};

export type LabOptions = {
  // Defaults to one hour from now, so the lab stays scheduled until a test deploys it
  startTime?: Date;
  // Defaults to no end time
  endTime?: Date | null;
};

export type Credentials = {username: string; password: string};

export type CollectionOut = {
  id: string;
  name: string;
  publicWrite: boolean;
  publicDeploy: boolean;
};

export type BindFileOut = {
  id: string;
  filePath: string;
  content: string;
  topologyId: string;
};

export type LabOut = {
  id: string;
  name: string;
  topologyId: string;
  collectionId: string;
  instance: {state: number} | null;
};

export type TopologyOut = {
  id: string;
  definition: string;
  syncUrl: string;
  collectionId: string;
  bindFiles: BindFileOut[];
};

/**
 * A minimal topology of Linux nodes (just host1 by default). The topology name is taken from the
 * definition, so every test passes its own unique name.
 *
 * The nodes get the position labels the graph editor stores when nodes are placed. Without them,
 * the editor draws every node at the same spot (see the known bug in node-editor.spec.ts).
 */
export function topologyDefinition(
  name: string,
  nodes: string[] = ['host1'],
): string {
  const nodeLines = nodes
    .map(
      (node, i) =>
        `    ${node}:\n      kind: linux\n      image: alpine:latest\n` +
        `      labels:\n        graph-posX: "${150 + i * 150}"\n        graph-posY: "300"`,
    )
    .join('\n');

  return `name: ${name}\ntopology:\n  nodes:\n${nodeLines}\n`;
}

/** Position labels for a node in a hand-written topology, as in topologyDefinition(). */
export function positionLabels(index: number): string {
  return `      labels:\n        graph-posX: "${150 + index * 150}"\n        graph-posY: "300"\n`;
}

export class AntimonyApi {
  private constructor(private readonly context: APIRequestContext) {}

  /** Creates a client that is logged in with the given native credentials. */
  static async login(credentials: Credentials): Promise<AntimonyApi> {
    const context = await request.newContext({baseURL: BASE_URL});
    const response = await context.post('/api/users/login/native', {
      data: credentials,
    });
    expect(response.ok(), `logging in as ${credentials.username}`).toBe(true);

    return new AntimonyApi(context);
  }

  static loginAsAdmin(): Promise<AntimonyApi> {
    return AntimonyApi.login(ADMIN);
  }

  async dispose() {
    await this.context.dispose();
  }

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

  async deleteCollection(collectionId: string) {
    await this.call('DELETE', `/collections/${collectionId}`);
  }

  /**
   * Deletes a resource and ignores whether that worked. Used to clean up after tests, where the
   * test may have deleted it already, or the backend refuses (e.g. for running labs).
   */
  async tryDelete(path: string) {
    await this.context.delete(`/api${path}`).catch(() => {});
  }

  async createTopology(
    collectionId: string,
    definition: string,
  ): Promise<string> {
    return this.call<string>('POST', '/topologies', {
      collectionId,
      definition,
      syncUrl: '',
    });
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

  async createLab(
    topologyId: string,
    name: string,
    options: LabOptions = {},
  ): Promise<string> {
    const startTime =
      options.startTime ?? new Date(Date.now() + 60 * 60 * 1000);

    return this.call<string>('POST', '/labs', {
      name,
      topologyId,
      startTime: startTime.toISOString(),
      endTime: options.endTime?.toISOString() ?? null,
    });
  }

  async getCollections(): Promise<CollectionOut[]> {
    return this.call<CollectionOut[]>('GET', '/collections');
  }

  async getTopologies(): Promise<TopologyOut[]> {
    return this.call<TopologyOut[]>('GET', '/topologies');
  }

  async getTopology(topologyId: string): Promise<TopologyOut> {
    return this.call<TopologyOut>('GET', `/topologies/${topologyId}`);
  }

  /** All labs the user can see (without a limit, the backend returns every lab). */
  async getLabs(): Promise<LabOut[]> {
    return this.call<LabOut[]>('GET', '/labs');
  }

  async findLab(name: string): Promise<LabOut | undefined> {
    return (await this.getLabs()).find(lab => lab.name === name);
  }

  /** Creates a non-admin user with access to the given collections (backend must run with -dev). */
  async createUser(
    credentials: Credentials,
    collections: string[],
  ): Promise<string> {
    return this.call<string>('POST', '/users', {...credentials, collections});
  }

  private async call<T>(
    method: string,
    path: string,
    data?: unknown,
  ): Promise<T> {
    const response = await this.context.fetch(`/api${path}`, {method, data});
    const body = (await response.json().catch(() => ({}))) as Partial<
      Payload<T>
    >;

    expect(
      response.ok(),
      `${method} ${path} failed: ${JSON.stringify(body)}`,
    ).toBe(true);
    expect(body, `${method} ${path} returned no payload`).toHaveProperty(
      'payload',
    );

    return body.payload as T;
  }
}
