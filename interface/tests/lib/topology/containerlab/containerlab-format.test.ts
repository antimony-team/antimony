import Ajv from 'ajv';
import {describe, expect, it} from 'vitest';

import {ContainerlabDefinition} from '@sb/lib/topology/containerlab/containerlab-definition';
import {ContainerlabFormat} from '@sb/lib/topology/containerlab/containerlab-format';

const validator = new Ajv({allErrors: true}).compile({
  type: 'object',
  required: ['name'],
  properties: {
    name: {type: 'string'},
    topology: {
      type: 'object',
      properties: {
        nodes: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {image: {type: 'string'}},
          },
        },
      },
    },
  },
});

describe('reading', () => {
  const format = new ContainerlabFormat(() => null);

  it('reads valid YAML as containerlab definition', () => {
    const definition = format.read('name: lab\n');

    expect(definition).toBeInstanceOf(ContainerlabDefinition);
    expect(definition?.name).toBe('lab');
  });

  it('does not read invalid YAML', () => {
    expect(format.read('name: [lab\n')).toBeNull();
    expect(format.read('a: b\n  c: d\n')).toBeNull();
  });

  it('reads template actions and environment variables as they are written', () => {
    const source = 'name: ${LAB_NAME}\n# {{ .Vars }}\n';

    expect(format.read(source)?.toString()).toBe(source);
  });

  it('names interfaces but does not connect more than two nodes', () => {
    expect(format.capabilities).toEqual({
      namedInterfaces: true,
      multiNodeLinks: false,
      nodeDialog: true,
    });
  });
});

describe('validation', () => {
  const format = new ContainerlabFormat(() => validator);

  function validate(source: string) {
    return format.validate(format.read(source)!);
  }

  it('accepts a valid topology', () => {
    expect(validate('name: lab\n')).toBeNull();
  });

  it('reports the error deepest in the topology', () => {
    expect(
      validate('name: 5\ntopology:\n  nodes:\n    a:\n      image: 5\n'),
    ).toBe('/topology/nodes/a/image must be string');
  });

  it('reports errors at the top without a path', () => {
    expect(validate('topology: {}\n')).toBe(
      "must have required property 'name'",
    );
  });

  it('reports that the schema is not loaded', () => {
    const unloaded = new ContainerlabFormat(() => null);

    expect(unloaded.validate(unloaded.read('name: lab\n')!)).toBe(
      'The containerlab schema is not loaded',
    );
  });

  it('reports an invalid topology if the validator has no errors', () => {
    const rejecting = Object.assign(() => false, {errors: null});
    const strict = new ContainerlabFormat(
      () => rejecting as unknown as typeof validator,
    );

    expect(strict.validate(strict.read('name: lab\n')!)).toBe(
      'Invalid topology',
    );
  });
});
