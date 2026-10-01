import {randomUUID} from 'node:crypto';
import {BrowserContext, Page, test as base} from '@playwright/test';

import {BASE_URL, CONTEXT_OPTIONS} from '../settings';
import {
  AntimonyApi,
  CollectionOptions,
  Credentials,
  topologyDefinition,
} from './api';

export {expect} from '@playwright/test';

export type Collection = {id: string; name: string};

export type Topology = {
  id: string;
  name: string;
  // The collection the topology was created in
  collection: Collection;
};

export type TopologyOptions = {
  // An existing collection to create the topology in, instead of a new one
  collection?: Collection;
  // Node names of the topology (default: host1)
  nodes?: string[];
  // Bind files to create, as path → content
  files?: Record<string, string>;
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
  // Defaults to no end time
  endTime?: Date | null;
};

export type Student = Credentials & {
  id: string;
  // A page logged in as the student, in its own browser context
  page: Page;
};

type Fixtures = {
  // The REST API, logged in as the admin
  api: AntimonyApi;

  // Returns a name nobody else uses, so tests never collide on the shared backend
  uniqueName: (prefix: string) => string;

  // Creates a collection with a unique name
  createCollection: (options?: CollectionOptions) => Promise<Collection>;

  // Creates a topology with a unique name, by default in a new collection
  createTopology: (options?: TopologyOptions) => Promise<Topology>;

  // Creates a lab with a unique name, by default from a new topology with host1 and host2. It
  // starts in an hour, so it stays undeployed until the test deploys it.
  createLab: (options?: LabOptions) => Promise<Lab>;

  // Creates a non-admin user with access to the given collection names and logs them in
  createStudent: (collections?: string[]) => Promise<Student>;
};

export const test = base.extend<Fixtures>({
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
   * The create* fixtures remove what they created once the test is done (best effort), so the
   * shared backend doesn't fill up. Long lists would otherwise push each test's rows in the editor
   * tree under the floating "Add Group" button (see the known bug in collections.spec.ts).
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
      await api.tryDelete(`/collections/${id}`);
    }
  },

  createTopology: async ({api, createCollection, uniqueName}, use) => {
    const created: string[] = [];

    await use(async (options = {}) => {
      const collection = options.collection ?? (await createCollection());
      const name = uniqueName('topology');
      const id = await api.createTopology(
        collection.id,
        topologyDefinition(name, options.nodes),
      );

      created.push(id);

      for (const [filePath, content] of Object.entries(options.files ?? {})) {
        await api.createBindFile(id, filePath, content);
      }

      return {id, name, collection};
    });

    for (const id of created.reverse()) {
      await api.tryDelete(`/topologies/${id}`);
    }
  },

  createLab: async ({api, createTopology, uniqueName}, use) => {
    const created: string[] = [];

    await use(async (options = {}) => {
      const topology =
        options.topology ??
        (await createTopology({nodes: ['host1', 'host2'], ...options}));
      const name = uniqueName('lab');
      const id = await api.createLab(topology.id, name, options);
      created.push(id);

      return {id, name, topology};
    });

    // Running labs can't be deleted; their collection is still removed, which hides them in the editor
    for (const id of created.reverse()) {
      await api.tryDelete(`/labs/${id}`);
    }
  },

  createStudent: async ({api, browser, uniqueName}, use) => {
    const contexts: BrowserContext[] = [];

    await use(async (collections = []) => {
      const credentials = {
        username: uniqueName('student'),
        password: 'student',
      };
      const id = await api.createUser(credentials, collections);

      // context.request shares its cookies with the context, so logging in through the API logs
      // the browser in as well.
      const context = await browser.newContext({
        ...CONTEXT_OPTIONS,
        baseURL: BASE_URL,
      });
      contexts.push(context);
      await context.request.post('/api/users/login/native', {
        data: credentials,
      });

      return {...credentials, id, page: await context.newPage()};
    });

    await Promise.all(contexts.map(context => context.close()));
  },
});
