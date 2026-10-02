import { mkdtemp, mkdir, rm, writeFile, appendFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexUsageReader } from './codex-usage-reader';

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(path.join(tmpdir(), 'emdash-codex-usage-'));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

async function writeRolloutFile(sessionId: string, lines: readonly unknown[]): Promise<string> {
  const dir = path.join(configDir, 'sessions', '2026', '10', '01');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-10-01T00-00-00-${sessionId}.jsonl`);
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return file;
}

function sessionMeta(opts: { sessionId: string; cwd: string; timestamp: string }) {
  return {
    timestamp: opts.timestamp,
    type: 'session_meta',
    payload: { session_id: opts.sessionId, cwd: opts.cwd },
  };
}

function turnContext(opts: { timestamp: string; model: string }) {
  return { timestamp: opts.timestamp, type: 'turn_context', payload: { model: opts.model } };
}

function tokenCountEvent(opts: {
  timestamp: string;
  total: { input: number; output: number };
  rateLimits?: unknown;
}) {
  return {
    timestamp: opts.timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: opts.total.input,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: opts.total.output,
          reasoning_output_tokens: 0,
          total_tokens: opts.total.input + opts.total.output,
        },
      },
      ...(opts.rateLimits ? { rate_limits: opts.rateLimits } : {}),
    },
  };
}

function tokenUsageRecord(opts: {
  timestamp: string;
  sessionId: string;
  thread: { input: number; output: number };
}) {
  return {
    timestamp: opts.timestamp,
    type: 'token_usage_record',
    payload: {
      session_id: opts.sessionId,
      thread_token_usage: {
        input_tokens: opts.thread.input,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: opts.thread.output,
        reasoning_output_tokens: 0,
        total_tokens: opts.thread.input + opts.thread.output,
      },
    },
  };
}

describe('CodexUsageReader', () => {
  it('reads cumulative tokens and model from a session_meta + turn_context + token_count rollout', async () => {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    await writeRolloutFile('a', [
      sessionMeta({ sessionId: 'rollout-a', cwd: '/home/ubuntu/demo', timestamp: iso }),
      turnContext({ timestamp: iso, model: 'gpt-5-codex' }),
      tokenCountEvent({ timestamp: iso, total: { input: 1000, output: 200 } }),
    ]);

    const reader = new CodexUsageReader(configDir);
    const result = await reader.scan(now - 60_000);

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.sessionId).toBe('rollout-a');
    expect(session.cwd).toBe('/home/ubuntu/demo');
    expect(session.model).toBe('gpt-5-codex');
    expect(session.tokens).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningOutputTokens: 0,
      totalTokens: 1200,
    });
  });

  it('reads cumulative tokens from a token_usage_record rollout (newer CLI shape)', async () => {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    await writeRolloutFile('b', [
      sessionMeta({ sessionId: 'rollout-b', cwd: '/home/ubuntu/demo', timestamp: iso }),
      tokenUsageRecord({
        timestamp: iso,
        sessionId: 'rollout-b',
        thread: { input: 500, output: 80 },
      }),
    ]);

    const reader = new CodexUsageReader(configDir);
    const result = await reader.scan(now - 60_000);
    expect(result.sessions[0].tokens?.totalTokens).toBe(580);
  });

  it('classifies rate-limit windows by duration, not by primary/secondary slot', async () => {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    await writeRolloutFile('c', [
      sessionMeta({ sessionId: 'rollout-c', cwd: '/home/ubuntu/demo', timestamp: iso }),
      tokenCountEvent({
        timestamp: iso,
        total: { input: 10, output: 10 },
        rateLimits: {
          primary: { used_percent: 9, window_minutes: 10080, resets_at: 1791458158 },
          secondary: null,
        },
      }),
    ]);

    const reader = new CodexUsageReader(configDir);
    const result = await reader.scan(now - 60_000);
    expect(result.latestRateLimits).not.toBeNull();
    expect(result.latestRateLimits?.weekly).toEqual({
      usedPercent: 9,
      windowMinutes: 10080,
      resetsAt: 1791458158 * 1000,
    });
    expect(result.latestRateLimits?.fiveHour).toBeNull();
  });

  it('treats a missing rate_limits field as the normal case, not an error', async () => {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    await writeRolloutFile('d', [
      sessionMeta({ sessionId: 'rollout-d', cwd: '/home/ubuntu/demo', timestamp: iso }),
      tokenCountEvent({ timestamp: iso, total: { input: 10, output: 10 } }),
    ]);

    const reader = new CodexUsageReader(configDir);
    const result = await reader.scan(now - 60_000);
    expect(result.sessions).toHaveLength(1);
    expect(result.latestRateLimits).toBeNull();
  });

  it('picks the most recent rate_limits snapshot across multiple sessions', async () => {
    const now = Date.now();
    const earlier = new Date(now - 10_000).toISOString();
    const later = new Date(now).toISOString();
    await writeRolloutFile('older', [
      sessionMeta({ sessionId: 'rollout-older', cwd: '/d', timestamp: earlier }),
      tokenCountEvent({
        timestamp: earlier,
        total: { input: 1, output: 1 },
        rateLimits: { primary: { used_percent: 1, window_minutes: 300, resets_at: 1 } },
      }),
    ]);
    await writeRolloutFile('newer', [
      sessionMeta({ sessionId: 'rollout-newer', cwd: '/d', timestamp: later }),
      tokenCountEvent({
        timestamp: later,
        total: { input: 1, output: 1 },
        rateLimits: { primary: { used_percent: 42, window_minutes: 300, resets_at: 2 } },
      }),
    ]);

    const reader = new CodexUsageReader(configDir);
    const result = await reader.scan(now - 60_000);
    expect(result.latestRateLimits?.fiveHour?.usedPercent).toBe(42);
  });

  it('only re-reads bytes appended since the last scan', async () => {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    const file = await writeRolloutFile('e', [
      sessionMeta({ sessionId: 'rollout-e', cwd: '/home/ubuntu/demo', timestamp: iso }),
      tokenCountEvent({ timestamp: iso, total: { input: 100, output: 100 } }),
    ]);

    const reader = new CodexUsageReader(configDir);
    const first = await reader.scan(now - 60_000);
    expect(first.sessions[0].tokens?.totalTokens).toBe(200);

    await appendFile(
      file,
      JSON.stringify(tokenCountEvent({ timestamp: iso, total: { input: 300, output: 300 } })) + '\n'
    );
    const second = await reader.scan(now - 60_000);
    // The later token_count line's cumulative total replaces the earlier one.
    expect(second.sessions[0].tokens?.totalTokens).toBe(600);
  });

  it('excludes files whose mtime is before the requested window', async () => {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    const file = await writeRolloutFile('f', [
      sessionMeta({ sessionId: 'rollout-f', cwd: '/d', timestamp: iso }),
      tokenCountEvent({ timestamp: iso, total: { input: 1, output: 1 } }),
    ]);
    const yesterday = (now - 24 * 60 * 60 * 1000) / 1000;
    await utimes(file, yesterday, yesterday);

    const reader = new CodexUsageReader(configDir);
    const result = await reader.scan(now - 60_000);
    expect(result.sessions).toHaveLength(0);
  });

  it('returns no sessions when the config dir does not exist', async () => {
    const reader = new CodexUsageReader(path.join(configDir, 'missing'));
    const result = await reader.scan(Date.now() - 60_000);
    expect(result.sessions).toEqual([]);
    expect(result.latestRateLimits).toBeNull();
  });
});
