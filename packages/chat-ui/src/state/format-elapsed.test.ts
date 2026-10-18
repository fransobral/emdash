import { describe, expect, it } from 'vitest';
import { formatElapsed } from './format-elapsed';

describe('formatElapsed', () => {
  it('formats seconds as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(24_900)).toBe('0:24');
    expect(formatElapsed(125_000)).toBe('2:05');
  });

  it('clamps negative input', () => {
    expect(formatElapsed(-5000)).toBe('0:00');
  });
});
