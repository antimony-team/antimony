import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ClockStore} from '@sb/lib/stores/clock-store';

describe('ClockStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks once per second', () => {
    const clock = new ClockStore();
    expect(clock.now).toBe(0);

    vi.advanceTimersByTime(999);
    expect(clock.now).toBe(0);

    vi.advanceTimersByTime(1);
    expect(clock.now).toBe(1000);
  });
});
