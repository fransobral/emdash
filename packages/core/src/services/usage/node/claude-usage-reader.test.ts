import { mkdtemp, mkdir, rm, writeFile, appendFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeUsageReader } from './claude-usage-reader';

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(path.join(tmpdir(), 'emdash-claude-usage-'));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

async function writeSessionFile(sessionId: string, lines: readonly unknown[]): Promise<string> {
  const dir = path.join(configDir, 'projects', '-home-ubuntu-demo');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return file;
}

function assistantLine(opts: {
  sessionId: string;
  cwd: string;
  timestamp: string;
  model: string;
  input: number;
  output: number;
}) {
  return {
    type: 'assistant',
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    timestamp: opts.timestamp,
    message: {
      model: opts.model,
      usage: {
        input_tokens: opts.input,
        output_tokens: opts.output,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

function costStateLine(opts: {
  sessionId: string;
  totalCostUSD: number;
  startTime: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}) {
  return {
    type: 'cost-state',
    sessionId: opts.sessionId,
    totalCostUSD: opts.totalCostUSD,
    startTime: opts.startTime,
    hasUnknownModelCost: false,
    modelUsage: {
      [opts.model]: {
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: opts.costUSD,
      },
    },
  };
}

describe('ClaudeUsageReader', () => {
  it('uses the exact cost-state summary when present', async () => {
    const now = Date.now();
    await writeSessionFile('session-a', [
      assistantLine({
        sessionId: 'session-a',
        cwd: '/home/ubuntu/demo',
        timestamp: new Date(now).toISOString(),
        model: 'claude-sonnet-4-5-20250929',
        input: 100,
        output: 50,
      }),
      costStateLine({
        sessionId: 'session-a',
        totalCostUSD: 1.23,
        startTime: now,
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 100,
        outputTokens: 50,
        costUSD: 1.23,
      }),
    ]);

    const reader = new ClaudeUsageReader(configDir);
    const result = await reader.scan(now - 60_000);

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.sessionId).toBe('session-a');
    expect(session.cwd).toBe('/home/ubuntu/demo');
    expect(session.totalCostUsd).toBeCloseTo(1.23);
    expect(session.costSource).toBe('exact');
    expect(session.models).toEqual([
      {
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 1.23,
        costSource: 'exact',
      },
    ]);
  });

  it('falls back to estimated cost from live usage when no cost-state line exists yet', async () => {
    const now = Date.now();
    await writeSessionFile('session-b', [
      assistantLine({
        sessionId: 'session-b',
        cwd: '/home/ubuntu/demo',
        timestamp: new Date(now).toISOString(),
        model: 'claude-haiku-4-5-20251001',
        input: 2_000_000,
        output: 0,
      }),
    ]);

    const reader = new ClaudeUsageReader(configDir);
    const result = await reader.scan(now - 60_000);

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.costSource).toBe('estimated');
    expect(session.totalCostUsd).toBeCloseTo(2, 5);
    expect(session.models[0].costSource).toBe('estimated');
  });

  it('marks cost as unavailable for an unknown model with no price entry', async () => {
    const now = Date.now();
    await writeSessionFile('session-c', [
      assistantLine({
        sessionId: 'session-c',
        cwd: '/home/ubuntu/demo',
        timestamp: new Date(now).toISOString(),
        model: 'claude-opus-5-5[1m]',
        input: 10,
        output: 10,
      }),
    ]);

    const reader = new ClaudeUsageReader(configDir);
    const result = await reader.scan(now - 60_000);

    expect(result.sessions[0].totalCostUsd).toBeNull();
    expect(result.sessions[0].costSource).toBe('unavailable');
  });

  it('only re-reads bytes appended since the last scan (incremental tail cache)', async () => {
    const now = Date.now();
    const file = await writeSessionFile('session-d', [
      assistantLine({
        sessionId: 'session-d',
        cwd: '/home/ubuntu/demo',
        timestamp: new Date(now).toISOString(),
        model: 'claude-haiku-4-5-20251001',
        input: 100,
        output: 100,
      }),
    ]);

    const reader = new ClaudeUsageReader(configDir);
    const first = await reader.scan(now - 60_000);
    expect(first.sessions[0].models[0].inputTokens).toBe(100);

    await appendFile(
      file,
      JSON.stringify(
        assistantLine({
          sessionId: 'session-d',
          cwd: '/home/ubuntu/demo',
          timestamp: new Date(now).toISOString(),
          model: 'claude-haiku-4-5-20251001',
          input: 50,
          output: 50,
        })
      ) + '\n'
    );

    const second = await reader.scan(now - 60_000);
    // Token totals accumulate across the two lines, never double-counted or reset.
    expect(second.sessions[0].models[0].inputTokens).toBe(150);
    expect(second.sessions[0].models[0].outputTokens).toBe(150);
  });

  it('ignores an incomplete trailing line until it is terminated by a newline', async () => {
    const now = Date.now();
    const dir = path.join(configDir, 'projects', '-home-ubuntu-demo');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'session-e.jsonl');
    const complete =
      JSON.stringify(
        assistantLine({
          sessionId: 'session-e',
          cwd: '/home/ubuntu/demo',
          timestamp: new Date(now).toISOString(),
          model: 'claude-haiku-4-5-20251001',
          input: 10,
          output: 10,
        })
      ) + '\n';
    const partial = '{"type":"assistant","message":{"usage":{"input_tok';
    await writeFile(file, complete + partial);

    const reader = new ClaudeUsageReader(configDir);
    const result = await reader.scan(now - 60_000);
    expect(result.sessions[0].models[0].inputTokens).toBe(10);
  });

  it('excludes and evicts files whose mtime is before the requested window', async () => {
    const now = Date.now();
    const file = await writeSessionFile('session-f', [
      assistantLine({
        sessionId: 'session-f',
        cwd: '/home/ubuntu/demo',
        timestamp: new Date(now).toISOString(),
        model: 'claude-haiku-4-5-20251001',
        input: 10,
        output: 10,
      }),
    ]);
    const yesterday = (now - 24 * 60 * 60 * 1000) / 1000;
    await utimes(file, yesterday, yesterday);

    const reader = new ClaudeUsageReader(configDir);
    const result = await reader.scan(now - 60_000);
    expect(result.sessions).toHaveLength(0);
  });

  it('returns no sessions when the config dir does not exist', async () => {
    const reader = new ClaudeUsageReader(path.join(configDir, 'missing'));
    const result = await reader.scan(Date.now() - 60_000);
    expect(result.sessions).toEqual([]);
  });
});
