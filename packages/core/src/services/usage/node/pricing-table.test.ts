import { describe, expect, it } from 'vitest';
import { estimateCostUsd, lookupModelPrice } from './pricing-table';

describe('lookupModelPrice', () => {
  it('matches a dated model id by its family prefix', () => {
    expect(lookupModelPrice('claude-sonnet-4-5-20250929')).toEqual({
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    });
  });

  it('prefers the longest matching prefix', () => {
    // "claude-haiku-4-5" must not be shadowed by a shorter, unrelated prefix.
    expect(lookupModelPrice('claude-haiku-4-5-20251001')?.outputPerMTok).toBe(5);
  });

  it('returns null for an unknown or future model id rather than guessing', () => {
    expect(lookupModelPrice('claude-opus-5-5[1m]')).toBeNull();
    expect(lookupModelPrice('gpt-6.1-sol')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(lookupModelPrice('CLAUDE-SONNET-4-5-20250929')).not.toBeNull();
  });
});

describe('estimateCostUsd', () => {
  it('computes cost from input, output, and cache tokens at list price', () => {
    const cost = estimateCostUsd('claude-sonnet-4-5-20250929', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
    });
    // 3 (input) + 15 (output) + 0.3 (cache read) + 3.75 (cache write)
    expect(cost).toBeCloseTo(22.05, 5);
  });

  it('ignores absent cache fields', () => {
    const cost = estimateCostUsd('claude-haiku-4-5-20251001', {
      inputTokens: 2_000_000,
      outputTokens: 0,
    });
    expect(cost).toBeCloseTo(2, 5);
  });

  it('returns null when the model price is unknown', () => {
    expect(estimateCostUsd('gpt-6.1-sol', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});
