import {BrowserContext, Page, test as base} from '@playwright/test';
import {randomUUID} from 'node:crypto';

import {BASE_URL, CONTEXT_OPTIONS} from '../settings';
import {
  AntimonyApi,
  CollectionOptions,
  Credentials,
  InstanceState,
  nodeAnnotations,
  topologyDefinition,
} from './api';

export {expect} from '@playwright/test';

/**
 * Marks a test of a bug that isn't fixed yet. The test asserts the correct behaviour and is expected to
 * fail, so the suite stays green; once the bug is fixed, Playwright reports the test as unexpectedly
 * passing. With E2E_KNOWN_BUGS=1 these tests run as normal tests, to check that they fail for the
 * reason they describe. Every known bug is listed in BUGS.md.
 */
export function knownBug(description: string) {
  base.fail(!process.env.E2E_KNOWN_BUGS, `Known bug: ${description}`);
}

export type Collection = {id: string; name: string};

export type Topology = {
  id: string;
  name: string;
  // The collection the topology was created in
  collection: Collection;
  nodes: string[];
};

export type TopologyOptions = {
  // An existing collection to create the topology in, instead of a new one
  collection?: Collection;
  // Options of the new collection, when no collection is given
  collectionOptions?: CollectionOptions;
  // Node names of the topology (default: host1 and host2, connected)
  nodes?: string[];
  // A complete definition instead of the generated one. Its name must be the one passed to it.
  definition?: (name: string) => string;
  // Annotations instead of the generated node positions
  annotations?: string;
  // Bind files to create, as path → content
  files?: Record<string, string>;
  // Who creates the topology (default: the admin)
  by?: User;
};

export type Lab = {
  id: string;
  name: string;
  topology: Topology;
};

export type LabOptions = TopologyOptions & {
  // An existing topology to create the lab from, instead of a new one
  topology?: Topology;
  // Defaults to one hour from now
  startTime?: Date;
  // Defaults to an hour after the start, null runs indefinitely
  endTime?: Date | null;
  // Deploys the lab right away and waits until it runs
  deployed?: boolean;
};

export type User = Credentials & {
  id: string;
  // The REST API, logged in as this user
  api: AntimonyApi;
};

export type UserWithPage = User & {
  // A page logged in as the user, in its own browser context
  page: Page;
};

export type UserOptions = {
  // The collections the user is a member of
  collections?: Collection[];
};

type Fixtures = {
  // The REST API, logged in as the admin
  api: AntimonyApi;

  // Returns a name nobody else uses, so tests never collide on the shared server
  uniqueName: (prefix: string) => string;

  // Creates a collection with a unique name
  createCollection: (options?: CollectionOptions) => Promise<Collection>;

  // Creates a topology with a unique name, by default in a new collection
  createTopology: (options?: TopologyOptions) => Promise<Topology>;

  // Creates a lab with a unique name, by default from a new topology with host1 and host2. It starts
  // in an hour, so it stays undeployed until the test deploys it (or `deployed` is set).
  createLab: (options?: LabOptions) => Promise<Lab>;

  // Creates a non-admin user who is a member of the given collections, with an API client
  createUser: (options?: UserOptions) => Promise<User>;

  // Like createUser, and also opens a browser page logged in as the user
  loginAs: (options?: UserOptions) => Promise<UserWithPage>;
};

/*
 * UI state the interface keeps in localStorage, set before the first page load of every context:
 * the editor tour is done, so it doesn't start by itself and cover the page, and no lab group is
 * collapsed (by default Inactive is). Only keys that aren't set yet are written, so tests can still
 * change them and reload.
 */
const INITIAL_UI_STATE: Record<string, string> = {
  'sb:completed-tours': JSON.stringify(['editor']),
  'sb:lab-grid-collapsed-groups': JSON.stringify({__type: 'Set', values: []}),
};

export async function prepareContext(context: BrowserContext) {
  await context.addInitScript(state => {
    for (const [key, value] of Object.entries(state)) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }
  }, INITIAL_UI_STATE);
}

export const test = base.extend<Fixtures>({
  context: async ({context}, use) => {
    await prepareContext(context);
    await use(context);
  },

  // eslint-disable-next-line no-empty-pattern
  api: async ({}, use) => {
    const api = await AntimonyApi.loginAsAdmin();
    await use(api);
    await api.dispose();
  },

  // eslint-disable-next-line no-empty-pattern
  uniqueName: async ({}, use) => {
    await use(prefix => `${prefix}-${randomUUID().slice(0, 8)}`);
  },

  /*
   * The create* fixtures remove what they created once the test is done, as the admin and ignoring
   * errors (the test may have deleted it already). Running labs are destroyed first, since the server
   * refuses to delete them and their collections.
   */
  createCollection: async ({api, uniqueName}, use) => {
    const created: string[] = [];

    await use(async options => {
      const name = uniqueName('collection');
      const id = await api.createCollection(name, options);
      created.push(id);

      return {id, name};
    });

    for (const id of created.reverse()) {
      await api.raw('DELETE', `/collections/${id}`).catch(() => {});
    }
  },

  createTopology: async ({api, createCollection, uniqueName}, use) => {
    const created: string[] = [];

    await use(async (options = {}) => {
      const collection =
        options.collection ??
        (await createCollection(options.collectionOptions));
      const name = uniqueName('topology');
      const nodes = options.nodes ?? ['host1', 'host2'];
      const id = await (options.by?.api ?? api).createTopology(
        collection.id,
        options.definition?.(name) ?? topologyDefinition(name, nodes),
        options.annotations ?? nodeAnnotations(nodes),
      );
      created.push(id);

      for (const [filePath, content] of Object.entries(options.files ?? {})) {
        await (options.by?.api ?? api).createBindFile(id, filePath, content);
      }

      return {id, name, collection, nodes};
    });

    for (const id of created.reverse()) {
      await api.raw('DELETE', `/topologies/${id}`).catch(() => {});
    }
  },

  createLab: async ({api, createTopology, uniqueName}, use) => {
    const created: string[] = [];

    await use(async (options = {}) => {
      // The topology is the admin's; `by` only says who creates the lab
      const topology =
        options.topology ?? (await createTopology({...options, by: undefined}));
      const name = uniqueName('lab');
      const by = options.by?.api ?? api;
      const id = await by.createLab(topology.id, name, options);
      created.push(id);

      if (options.deployed) await by.deployLab(id);

      return {id, name, topology};
    });

    for (const id of created.reverse()) {
      const lab = await api.getLab(id).catch(() => null);
      if (lab?.instance && lab.instance.state !== InstanceState.Stopping) {
        await api.destroyLab(id).catch(() => {});
      }
      await api.raw('DELETE', `/labs/${id}`).catch(() => {});
    }
  },

  createUser: async ({api, uniqueName}, use) => {
    const clients: AntimonyApi[] = [];

    await use(async (options = {}) => {
      const credentials = {username: uniqueName('user'), password: 'student'};
      const id = await api.createUser(
        credentials,
        (options.collections ?? []).map(collection => collection.name),
      );
      const userApi = await AntimonyApi.login(credentials);
      clients.push(userApi);

      return {...credentials, id, api: userApi};
    });

    await Promise.all(clients.map(client => client.dispose()));
  },

  loginAs: async ({browser, createUser}, use) => {
    const contexts: BrowserContext[] = [];

    await use(async (options = {}) => {
      const user = await createUser(options);

      // context.request shares its cookies with the context, so logging in through the API logs
      // the browser in as well.
      const context = await browser.newContext({
        ...CONTEXT_OPTIONS,
        baseURL: BASE_URL,
      });
      contexts.push(context);
      await prepareContext(context);

      const response = await context.request.post('/api/users/login/native', {
        data: {username: user.username, password: user.password},
      });
      if (!response.ok()) {
        throw new Error(`logging in as ${user.username}: ${response.status()}`);
      }

      return {...user, page: await context.newPage()};
    });

    await Promise.all(contexts.map(context => context.close()));
  },
});
