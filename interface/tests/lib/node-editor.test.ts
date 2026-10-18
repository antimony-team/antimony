import Ajv from 'ajv';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {NodeEditor, PropertyIO} from '@sb/lib/node-editor';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';
import {ClabSchema} from '@sb/types/domain/schema';
import {TopologyAnnotations} from '@sb/types/domain/topology';

const NODE_CONFIG = {
  type: 'object',
  properties: {
    kind: {type: 'string', description: 'Kind'},
    image: {type: 'string', description: 'Image'},
    'image-pull-policy': {
      type: 'string',
      description: 'Pull policy',
      enum: ['IfNotPresent', 'ifnotpresent', 'Always', 'Never'],
    },
    'startup-delay': {type: 'integer', description: 'Delay'},
    'cpu-set': {type: 'number', description: 'CPUs'},
    'auto-remove': {type: 'boolean', description: 'Auto remove'},
    ports: {
      anyOf: [
        {
          type: 'array',
          items: {type: 'string'},
          minItems: 1,
          uniqueItems: true,
          description: 'Ports',
        },
        {type: 'string', description: 'Port'},
      ],
    },
    binds: {type: 'array', items: {type: 'string'}, description: 'Binds'},
    env: {
      type: 'object',
      description: 'Environment',
      patternProperties: {
        '.*': {
          oneOf: [
            {type: 'string', description: 'Variable'},
            {type: 'number', description: 'Variable'},
          ],
        },
      },
    },
    labels: {type: 'object', description: 'Labels'},
    healthcheck: {type: 'object', description: 'Health check'},
  },
};

const SCHEMA = {
  type: 'object',
  properties: {
    topology: {
      type: 'object',
      properties: {
        defaults: {$ref: '#/definitions/node-config'},
        nodes: {
          type: 'object',
          additionalProperties: {$ref: '#/definitions/node-config'},
        },
      },
    },
  },
  definitions: {'node-config': NODE_CONFIG},
};

const validator = new Ajv({strict: false}).compile(SCHEMA);
const format = new ContainerlabFormat(() => validator);

const TOPOLOGY = `name: test
topology:
  defaults:
    image: alpine
    binds: [default.cfg]
  nodes:
    r1:
      kind: linux
      startup-delay: 5
      binds: [r1.cfg]
      env:
        HOME: /root
      labels:
        graph-icon: router
    r2:
      kind: linux
  links:
    - endpoints: ["r1:eth1", "r2:eth1"]
    - endpoints: ["r1:eth2", "host:veth0"]
`;

const ANNOTATIONS: TopologyAnnotations = {
  nodeAnnotations: [{id: 'r1', position: {x: 0, y: 0}}],
};

describe('NodeEditor', () => {
  let statusMessageStore: {error: ReturnType<typeof vi.fn>};
  let editor: NodeEditor;

  function createEditor(nodeName = 'r1') {
    return new NodeEditor(
      SCHEMA as unknown as ClabSchema,
      format,
      nodeName,
      format.read(TOPOLOGY)!,
      ANNOTATIONS,
      statusMessageStore as unknown as StatusMessageStore,
    );
  }

  function property(key: string, properties = editor.getObjectProperties()) {
    return properties.find(property => property.key === key) as PropertyIO;
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    statusMessageStore = {error: vi.fn()};
    editor = createEditor();
  });

  describe('properties', () => {
    it('lists the own and the inherited properties without the ones edited elsewhere', () => {
      const keys = editor.getObjectProperties().map(property => property.key);

      expect(keys.sort()).toEqual(['binds', 'image', 'startup-delay']);
    });

    it('describes a property by its schema', () => {
      expect(property('startup-delay')).toMatchObject({
        value: 5,
        type: 'number',
        description: 'Delay',
        wasEdited: false,
        wasAdded: false,
      });
    });

    it('shows the inherited value of a property the node does not set', () => {
      expect(property('image')).toMatchObject({
        value: undefined,
        inheritedValue: 'alpine',
      });
    });

    it('shows the inherited entries a list adds to', () => {
      expect(property('binds')).toMatchObject({
        value: ['r1.cfg'],
        inheritedValue: ['default.cfg'],
        isArray: true,
      });
    });

    it('lists the entries of an object by its pattern properties', () => {
      const [home] = editor.getObjectProperties(
        'env',
        'node-config.properties.env',
      );

      expect(home).toMatchObject({key: 'HOME', value: '/root', type: 'string'});
    });

    it('lists the properties that are neither set nor inherited', () => {
      expect(editor.getAvailableProperties()!.sort()).toEqual([
        'auto-remove',
        'cpu-set',
        'image-pull-policy',
        'ports',
      ]);
    });

    it('has no restrictions on the keys of an object without known properties', () => {
      expect(
        editor.getAvailableProperties('env', 'node-config.properties.env'),
      ).toBeNull();
    });
  });

  describe('editing', () => {
    it('updates the value of a property', () => {
      const onEdit = vi.fn();
      editor.onEdit.register(onEdit);

      expect(property('startup-delay').onUpdateValue(10)).toBeNull();

      expect(editor.getNode()!.own(['startup-delay'])).toBe(10);
      expect(onEdit).toHaveBeenCalledWith(editor.getTopology());
      expect(property('startup-delay').wasEdited).toBe(true);
      expect(editor.hasEdits()).toBe(true);
    });

    it('rejects a value the schema does not accept', () => {
      const error = property('startup-delay').onUpdateValue('soon');

      expect(error).not.toBeNull();
      expect(statusMessageStore.error).toHaveBeenCalledWith(
        "Invalid value for property '/startup-delay'",
        'YAML Schema Error',
      );
      expect(editor.getNode()!.own(['startup-delay'])).toBe(5);
      expect(editor.hasEdits()).toBe(false);
    });

    it('inherits a property again when its value is emptied', () => {
      property('image').onUpdateValue('ubuntu');
      expect(editor.getNode()!.own(['image'])).toBe('ubuntu');
      expect(property('image').wasAdded).toBe(true);

      property('image').onUpdateValue('');
      expect(editor.getNode()!.own(['image'])).toBeUndefined();
      expect(editor.getNode()!.get('image')).toBe('alpine');
    });

    it('resets a property to its inherited value', () => {
      property('binds').onReset();

      expect(editor.getNode()!.own(['binds'])).toBeUndefined();
      expect(editor.getNode()!.get('binds')).toEqual(['default.cfg']);
    });

    it('renames the key of an entry', () => {
      const [home] = editor.getObjectProperties(
        'env',
        'node-config.properties.env',
      );
      home.onUpdateKey('USER_HOME');

      expect(editor.getNode()!.own(['env'])).toEqual({USER_HOME: '/root'});
    });

    it('adds properties with the default of their type', () => {
      const add = (key: string) => {
        editor.addProperty(key, '', 'node-config');
        return editor.getNode()!.own([key]);
      };

      expect(add('image-pull-policy')).toBe('IfNotPresent');
      expect(add('cpu-set')).toBe(0);
      expect(add('auto-remove')).toBe(false);
      expect(add('ports')).toEqual(['']);
    });

    it('takes the enum values of a property without duplicates in another case', () => {
      editor.addProperty('image-pull-policy', '', 'node-config');

      expect(property('image-pull-policy').availableValues).toEqual([
        'IfNotPresent',
        'Always',
        'Never',
      ]);
    });

    it('treats a property that can be a list or a value as a list', () => {
      editor.addProperty('ports', '', 'node-config');

      expect(property('ports')).toMatchObject({
        isArray: true,
        minItems: 1,
        uniqueItems: true,
        description: 'Ports',
      });
    });

    it('treats properties without a schema as text', () => {
      editor.addProperty('unknown-key', '', 'node-config');

      expect(property('unknown-key').type).toBe('string');
    });

    it('adds a property to a node that is not written yet', () => {
      editor = createEditor('r3');
      editor.addProperty('image', '', 'node-config');

      expect(editor.getTopology().nodeNames).toContain('r3');
      expect(editor.getNode()!.own(['image'])).toBe('');
    });
  });

  describe('names and links', () => {
    it('renames the node', () => {
      expect(editor.onUpdateName('core')).toBeNull();

      expect(editor.getNodeName()).toBe('core');
      expect(editor.getTopology().nodeNames).toEqual(['core', 'r2']);
      expect(editor.getAnnotations().nodeAnnotations![0].id).toBe('core');
      expect(editor.hasEdits()).toBe(true);
    });

    it('does not rename a node to a name that is taken', () => {
      expect(editor.onUpdateName('r2')).toBe(
        'A node with that name already exists',
      );
      expect(editor.getNodeName()).toBe('r1');
    });

    it('does nothing when the name stays the same', () => {
      expect(editor.onUpdateName('r1')).toBeNull();
      expect(editor.hasEdits()).toBe(false);
    });

    it('still knows the original values after a rename', () => {
      editor.onUpdateName('core');
      property('startup-delay').onUpdateValue(9);

      expect(property('startup-delay').wasEdited).toBe(true);
      expect(property('binds').wasEdited).toBe(false);
    });

    it('lists only the links to other nodes', () => {
      const links = editor.getLinks();

      expect(links).toHaveLength(1);
      expect(links[0].endpoints[1].node).toBe('r2');
    });

    it('renames an interface of a link', () => {
      editor.renameInterface(0, 0, 'eth5');

      expect(editor.getLinks()[0].endpoints[0].interface).toBe('eth5');
    });
  });

  describe('icons', () => {
    it('reads the icon from the graph labels', () => {
      expect(editor.getNodeIcon()).toBe('router');
      expect(editor.getNodeIcon('r2')).toBeUndefined();
    });

    it('writes a changed icon to the annotations', () => {
      editor.onUpdateIcon('switch');

      expect(editor.getNodeIcon()).toBe('switch');
      expect(editor.getAnnotations().nodeAnnotations![0].icon).toBe('switch');
      expect(editor.hasEdits()).toBe(true);
    });
  });
});
