import {describe, expect, it, vi} from 'vitest';

import {Binding} from '@sb/lib/utils/binding';

describe('Binding', () => {
  it('passes updates to all registered listeners', () => {
    const binding = new Binding<number>();
    const first = vi.fn();
    const second = vi.fn();
    binding.register(first);
    binding.register(second);

    binding.update(1);

    expect(first).toHaveBeenCalledWith(1);
    expect(second).toHaveBeenCalledWith(1);
  });

  it('stops passing updates to removed listeners', () => {
    const binding = new Binding<number>();
    const removed = vi.fn();
    const cleared = vi.fn();
    binding.register(removed);
    binding.unregister(removed);
    binding.update(1);

    binding.register(cleared);
    binding.clear();
    binding.update(2);

    expect(removed).not.toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
  });
});
