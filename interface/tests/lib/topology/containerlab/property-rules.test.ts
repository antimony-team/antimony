import {describe, expect, it} from 'vitest';

import {
  asDefinition,
  DEFAULT_RULE,
  isSet,
  LevelValue,
  PROPERTY_RULES,
} from '@sb/lib/topology/containerlab/property-rules';
import {PropertySource} from '@sb/types/domain/topology-definition';

const NODE: PropertySource = {level: 'node'};
const GROUP: PropertySource = {level: 'group', name: 'group'};
const KIND: PropertySource = {level: 'device', name: 'linux'};
const DEFAULTS: PropertySource = {level: 'defaults'};

function levels(
  node: unknown,
  group: unknown,
  kind: unknown,
  defaults: unknown,
): LevelValue[] {
  return [
    {source: NODE, value: node},
    {source: GROUP, value: group},
    {source: KIND, value: kind},
    {source: DEFAULTS, value: defaults},
  ].filter(({value}) => value !== undefined);
}

function combine(key: string, values: LevelValue[], isNodeEmpty = false) {
  return (PROPERTY_RULES.get(key) ?? DEFAULT_RULE).combine(values, isNodeEmpty);
}

describe('isSet', () => {
  it.each([undefined, null, '', 0, []])('counts %j as not set', value => {
    expect(isSet(value)).toBe(false);
  });

  it.each(['a', 1, -1, false, true, ['a'], {}])('counts %j as set', value => {
    expect(isSet(value)).toBe(true);
  });
});

describe('asDefinition', () => {
  it('returns objects as definitions', () => {
    const value = {a: 1};
    expect(asDefinition(value)).toBe(value);
  });

  it.each([null, undefined, [], 'a', 1, false])(
    'does not return %j as definition',
    value => {
      expect(asDefinition(value)).toBeNull();
    },
  );
});

describe('override', () => {
  it('takes the value of the most specific level that sets it', () => {
    expect(combine('image', levels(undefined, '', 'b', 'c'))).toEqual({
      value: 'b',
      sources: [KIND],
    });
  });

  it('returns nothing if no level sets the value', () => {
    expect(combine('image', levels('', 0, [], undefined))).toBeNull();
  });

  it('trims the type', () => {
    expect(
      combine('type', levels(' ixr-d2 ', undefined, 'x', undefined)),
    ).toEqual({value: 'ixr-d2', sources: [NODE]});
  });

  it('keeps a type that is not a string', () => {
    expect(combine('type', levels(5, undefined, undefined, undefined))).toEqual(
      {value: 5, sources: [NODE]},
    );
  });
});

describe('flags', () => {
  it('counts false as set', () => {
    expect(combine('privileged', levels(false, true, true, true))).toEqual({
      value: false,
      sources: [NODE],
    });
  });

  it('takes the most specific level', () => {
    expect(
      combine('auto-remove', levels(undefined, undefined, true, false)),
    ).toEqual({value: true, sources: [KIND]});
  });

  it('only takes the defaults for a node without a definition', () => {
    expect(
      combine('privileged', levels(undefined, true, true, false), true),
    ).toEqual({value: false, sources: [DEFAULTS]});
    expect(
      combine('privileged', levels(undefined, true, true, undefined), true),
    ).toBeNull();
  });
});

describe('lists', () => {
  it('joins the lists from the defaults to the node without duplicates', () => {
    expect(
      combine('exec', levels(['a', 'b'], undefined, ['c'], ['b', 'd'])),
    ).toEqual({value: ['b', 'd', 'c', 'a'], sources: [NODE, KIND, DEFAULTS]});
  });

  it('returns nothing for empty lists', () => {
    expect(combine('cap-add', levels([], undefined, [], undefined))).toBeNull();
  });
});

describe('binds', () => {
  it('replaces binds with the same destination and sorts them', () => {
    expect(
      combine(
        'binds',
        levels(['/node:/etc/config'], undefined, undefined, [
          '/defaults:/etc/config',
          '/b:/b:ro',
          '/a:/a',
        ]),
      ),
    ).toEqual({
      value: ['/a:/a', '/b:/b:ro', '/node:/etc/config'],
      sources: [NODE, DEFAULTS],
    });
  });

  it('keeps binds without a destination', () => {
    expect(
      combine('volumes', levels(['/data'], undefined, undefined, ['/x:/y'])),
    ).toEqual({value: ['/data', '/x:/y'], sources: [NODE, DEFAULTS]});
  });
});

describe('maps', () => {
  it('merges the keys with the more specific level winning', () => {
    expect(
      combine(
        'env',
        levels({A: 'node'}, {B: 'group'}, undefined, {A: 'defaults', C: 'c'}),
      ),
    ).toEqual({
      value: {A: 'node', B: 'group', C: 'c'},
      sources: [NODE, GROUP, DEFAULTS],
    });
  });

  it('ignores values that are not maps', () => {
    expect(
      combine('labels', levels('a', undefined, undefined, {A: 'a'})),
    ).toEqual({
      value: {A: 'a'},
      sources: [NODE, DEFAULTS],
    });
  });
});

describe('certificate', () => {
  it('takes each field from the most specific level that sets it', () => {
    expect(
      combine(
        'certificate',
        levels(
          {issue: true},
          undefined,
          {'key-size': 2048, issue: false},
          {
            'validity-duration': '1h',
            sans: [],
          },
        ),
      ),
    ).toEqual({
      value: {issue: true, 'key-size': 2048, 'validity-duration': '1h'},
      sources: [NODE, KIND, DEFAULTS],
    });
  });

  it('returns nothing if no field is set', () => {
    expect(
      combine('certificate', levels({sans: []}, undefined, undefined, {})),
    ).toBeNull();
  });
});

describe('stages', () => {
  it('joins the commands and the stages to wait for of all levels', () => {
    expect(
      combine(
        'stages',
        levels(
          {
            create: {
              'wait-for': [{node: 'b', stage: 'healthy'}],
              exec: ['node'],
            },
          },
          undefined,
          undefined,
          {
            create: {
              'wait-for': [
                {node: 'b', stage: 'healthy'},
                {node: 'c', stage: 'create'},
              ],
              exec: ['defaults'],
            },
            healthy: {exec: ['x']},
          },
        ),
      ),
    ).toEqual({
      value: {
        create: {
          'wait-for': [
            {node: 'b', stage: 'healthy'},
            {node: 'c', stage: 'create'},
          ],
          exec: ['defaults', 'node'],
        },
        healthy: {'wait-for': [], exec: ['x']},
      },
      sources: [NODE, DEFAULTS],
    });
  });
});

describe('credentials', () => {
  it('takes the username and the password together from one level', () => {
    expect(
      combine(
        'credentials',
        levels({password: 'secret'}, undefined, undefined, {
          username: 'admin',
          password: 'admin',
          'identity-file': '~/.ssh/id',
        }),
      ),
    ).toEqual({
      value: {
        username: undefined,
        password: 'secret',
        'identity-file': '~/.ssh/id',
      },
      sources: [NODE, DEFAULTS],
    });
  });

  it('lists a level that sets both only once', () => {
    expect(
      combine(
        'credentials',
        levels(
          {username: 'a', 'identity-file': 'id'},
          undefined,
          undefined,
          undefined,
        ),
      ),
    ).toEqual({
      value: {username: 'a', password: undefined, 'identity-file': 'id'},
      sources: [NODE],
    });
  });

  it('returns nothing without credentials', () => {
    expect(
      combine('credentials', levels({}, undefined, undefined, 'x')),
    ).toBeNull();
  });
});

describe('config', () => {
  it('deep merges the variables of all levels', () => {
    expect(
      combine(
        'config',
        levels(
          {vars: {a: {x: 'node'}}, templates: ['t']},
          undefined,
          undefined,
          {vars: {a: {x: 'defaults', y: 'y'}, b: 1}},
        ),
      ),
    ).toEqual({
      value: {vars: {a: {x: 'node', y: 'y'}, b: 1}},
      sources: [NODE, DEFAULTS],
    });
  });

  it('has no configuration for a node without a definition', () => {
    expect(
      combine(
        'config',
        levels(undefined, undefined, undefined, {vars: {a: 1}}),
        true,
      ),
    ).toBeNull();
  });
});
