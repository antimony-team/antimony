import Ajv from 'ajv';
import {describe, expect, it} from 'vitest';

import {
  AnnotationsFormat,
  serializeAnnotations,
} from '@sb/lib/format/annotations-format';

const validator = new Ajv().compile({
  type: 'object',
  properties: {nodeAnnotations: {type: 'array'}},
});

describe('AnnotationsFormat', () => {
  const codec = new AnnotationsFormat(() => validator);

  it('reads annotations that pass the schema', () => {
    expect(codec.parse('{"nodeAnnotations": []}')).toEqual({
      nodeAnnotations: [],
    });
  });

  it('does not read annotations that fail the schema', () => {
    expect(codec.parse('{"nodeAnnotations": {}}')).toBeNull();
  });

  it('reads annotations without checking them while the schema is not loaded', () => {
    const unloaded = new AnnotationsFormat(() => null);

    expect(unloaded.parse('{"nodeAnnotations": {}}')).toEqual({
      nodeAnnotations: {},
    });
  });

  it('does not read broken JSON or JSON that is not an object', () => {
    expect(codec.parse('{broken')).toBeNull();
    expect(codec.parse('5')).toBeNull();
    expect(codec.parse('null')).toBeNull();
  });

  it('writes annotations the way the server stores them', () => {
    const annotations = {nodeAnnotations: []};

    expect(codec.serialize(annotations)).toBe(
      JSON.stringify(annotations, null, 2),
    );
  });

  it('normalizes annotations to the form the server stores', () => {
    expect(codec.normalize('{"nodeAnnotations":[]}')).toBe(
      serializeAnnotations({nodeAnnotations: []}),
    );
  });

  it('leaves text it can not read as it is when normalizing', () => {
    expect(codec.normalize('{broken')).toBe('{broken');
  });
});

describe('serializeAnnotations', () => {
  it('serializes the same annotations only once', () => {
    const annotations = {nodeAnnotations: []};

    expect(serializeAnnotations(annotations)).toBe(
      serializeAnnotations(annotations),
    );
  });
});
