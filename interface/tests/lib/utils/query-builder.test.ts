import {describe, expect, it} from 'vitest';

import {QueryBuilder} from '@sb/lib/utils/query-builder';

describe('QueryBuilder', () => {
  it('starts with an empty query', () => {
    expect(new QueryBuilder().toString()).toBe('?');
  });

  it('adds parameters in order', () => {
    const query = new QueryBuilder().add('limit', 10).add('name', 'lab');
    expect(query.toString()).toBe('?limit=10&name=lab&');
  });

  it('leaves out missing values unless asked to keep them', () => {
    const query = new QueryBuilder()
      .add('a', undefined)
      .add('b', null)
      .add('c', null, false)
      .add('d', 0);
    expect(query.toString()).toBe('?c=null&d=0&');
  });

  it('adds lists as array parameters', () => {
    const query = new QueryBuilder().addList('id', ['a', 'b']).addList('n', []);
    expect(query.toString()).toBe('?id[]=a&id[]=b&');
  });
});
