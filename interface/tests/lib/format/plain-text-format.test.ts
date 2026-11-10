import {describe, expect, it} from 'vitest';

import {PlainTextFormat} from '@sb/lib/format/plain-text-format';

describe('PlainTextFormat', () => {
  const codec = new PlainTextFormat();

  it('reads and writes any text as it is', () => {
    const text = 'hostname r1\n  # not YAML: [\n';

    expect(codec.parse(text)).toBe(text);
    expect(codec.serialize(text)).toBe(text);
  });
});
