import { describe, expect, it } from 'vitest';
import { detectUsageLimit } from './codex-usage-limit';

const NOW = new Date('2026-10-01T12:00:00').getTime();

describe('detectUsageLimit', () => {
  it('detects a RequestError-shaped failure via data.codexErrorInfo', () => {
    const error = {
      message: 'Internal error',
      data: {
        codexErrorInfo: 'usageLimitExceeded',
        message:
          "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 3rd, 2026 2:10 PM.",
      },
    };
    const result = detectUsageLimit(error, NOW);
    expect(result).not.toBeNull();
    expect(result?.resetAt).toBe(new Date(2026, 9, 3, 14, 10, 0, 0).getTime());
  });

  it('parses a full month name and a day without an ordinal suffix', () => {
    const error = {
      data: {
        codexErrorInfo: 'usageLimitExceeded',
        message: 'Usage limit hit, try again at October 3, 2026 2:10 AM.',
      },
    };
    const result = detectUsageLimit(error, NOW);
    expect(result?.resetAt).toBe(new Date(2026, 9, 3, 2, 10, 0, 0).getTime());
  });

  it('detects the phrase in data.message even without codexErrorInfo', () => {
    const error = {
      data: { message: "You've hit your usage limit. Try again at Oct 3rd, 2026 2:10 PM." },
    };
    const result = detectUsageLimit(error, NOW);
    expect(result).not.toBeNull();
  });

  it('detects the phrase in the top-level error.message', () => {
    const error = new Error("You've hit your usage limit. Try again at Oct 3rd, 2026 2:10 PM.");
    const result = detectUsageLimit(error, NOW);
    expect(result).not.toBeNull();
  });

  it('falls back to now + 1h when the message has no parseable reset time', () => {
    const error = { data: { codexErrorInfo: 'usageLimitExceeded', message: 'Usage limit hit.' } };
    const result = detectUsageLimit(error, NOW);
    expect(result?.resetAt).toBe(NOW + 60 * 60 * 1000);
  });

  it('falls back to now + 1h when the parsed reset time is already in the past', () => {
    const error = {
      data: {
        codexErrorInfo: 'usageLimitExceeded',
        message: 'Usage limit hit, try again at Jan 1st, 2020 12:00 AM.',
      },
    };
    const result = detectUsageLimit(error, NOW);
    expect(result?.resetAt).toBe(NOW + 60 * 60 * 1000);
  });

  it('returns null for an unrelated error', () => {
    expect(detectUsageLimit(new Error('network timeout'), NOW)).toBeNull();
    expect(detectUsageLimit({ data: { codexErrorInfo: 'authRequired' } }, NOW)).toBeNull();
  });

  it('returns null for non-object errors', () => {
    expect(detectUsageLimit('boom', NOW)).toBeNull();
    expect(detectUsageLimit(null, NOW)).toBeNull();
    expect(detectUsageLimit(undefined, NOW)).toBeNull();
  });
});
