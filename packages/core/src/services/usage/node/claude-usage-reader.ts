import { open, stat } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { estimateCostUsd } from './pricing-table';

/**
 * Tail-scans `$CLAUDE_CONFIG_DIR/projects/**\/*.jsonl` for usage data.
 *
 * Only the narrow fields needed for usage accounting are read:
 * `type`, `sessionId`, `cwd`, `timestamp`, `message.model`, `message.usage`,
 * and the periodic `cost-state` summary line's `totalCostUSD` /
 * `modelUsage` / `hasUnknownModelCost`. Message `content`/`text` and
 * anything else in each line is discarded as soon as the line is parsed —
 * this file never buffers prompt or response text, and never touches
 * `.credentials.json`.
 */

export type ClaudeModelUsage = Readonly<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number | null;
  /** Whether `costUsd` came from Claude Code's own bookkeeping or our price table. */
  costSource: 'exact' | 'estimated' | 'unavailable';
}>;

export type ClaudeSessionUsage = Readonly<{
  sessionId: string;
  cwd: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  totalCostUsd: number | null;
  costSource: 'exact' | 'estimated' | 'unavailable';
  hasUnknownModelCost: boolean;
  models: readonly ClaudeModelUsage[];
}>;

export type ClaudeUsageScan = Readonly<{
  sessions: readonly ClaudeSessionUsage[];
}>;

type LiveModelTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

type ExactModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
};

type FileAggregate = {
  sessionId: string | null;
  cwd: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  totalCostUsd: number | null;
  hasUnknownModelCost: boolean;
  exactModels: Map<string, ExactModelUsage> | null;
  liveModels: Map<string, LiveModelTotals>;
};

type CacheEntry = {
  mtimeMs: number;
  offset: number;
  aggregate: FileAggregate;
};

function emptyAggregate(): FileAggregate {
  return {
    sessionId: null,
    cwd: null,
    startedAt: null,
    lastActivityAt: null,
    totalCostUsd: null,
    hasUnknownModelCost: false,
    exactModels: null,
    liveModels: new Map(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Reads usage from Claude Code's own on-disk transcript logs for one
 * `CLAUDE_CONFIG_DIR`. Keeps an in-memory per-file byte-offset cache so a
 * file already scanned is never re-read from the start; only the bytes
 * appended since the last scan are parsed.
 */
export class ClaudeUsageReader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly configDir: string) {}

  /**
   * Scans every session file whose mtime is at or after `sinceMs`. Files
   * last modified before `sinceMs` are dropped from the cache (they belong
   * to a previous day and will not be asked for again).
   */
  async scan(sinceMs: number): Promise<ClaudeUsageScan> {
    const pattern = path.join(this.configDir, 'projects', '*', '*.jsonl');
    const files: string[] = [];
    try {
      for await (const file of glob(pattern)) files.push(file);
    } catch {
      return { sessions: [] };
    }

    const seen = new Set<string>();
    const sessions: ClaudeSessionUsage[] = [];
    for (const file of files) {
      seen.add(file);
      const aggregate = await this.scanFile(file, sinceMs);
      if (aggregate) sessions.push(toSessionUsage(file, aggregate));
    }

    for (const cachedPath of [...this.cache.keys()]) {
      if (!seen.has(cachedPath)) this.cache.delete(cachedPath);
    }

    return { sessions };
  }

  private async scanFile(file: string, sinceMs: number): Promise<FileAggregate | null> {
    let stats;
    try {
      stats = await stat(file);
    } catch {
      this.cache.delete(file);
      return null;
    }

    if (stats.mtimeMs < sinceMs) {
      this.cache.delete(file);
      return null;
    }

    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === stats.mtimeMs) return cached.aggregate;

    const aggregate = cached ? cached.aggregate : emptyAggregate();
    const startOffset = cached && stats.size >= cached.offset ? cached.offset : 0;
    const nextOffset = await appendLinesFromOffset(file, startOffset, aggregate);
    this.cache.set(file, { mtimeMs: stats.mtimeMs, offset: nextOffset, aggregate });
    return aggregate;
  }
}

/** Reads new bytes from `offset` onward, applies each complete line, and returns the new offset. */
async function appendLinesFromOffset(
  file: string,
  offset: number,
  aggregate: FileAggregate
): Promise<number> {
  const handle = await open(file, 'r');
  try {
    const stats = await handle.stat();
    const length = stats.size - offset;
    if (length <= 0) return offset;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const text = buffer.toString('utf8', 0, bytesRead);
    const lines = text.split('\n');
    // The last element is either '' (trailing newline) or an incomplete line
    // still being written; neither is a complete record to parse yet.
    lines.pop();
    let consumed = 0;
    for (const line of lines) {
      consumed += Buffer.byteLength(line, 'utf8') + 1;
      if (line.trim().length > 0) applyLine(aggregate, line);
    }
    return offset + consumed;
  } finally {
    await handle.close();
  }
}

function applyLine(aggregate: FileAggregate, line: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;

  if (typeof parsed.sessionId === 'string') aggregate.sessionId = parsed.sessionId;
  if (typeof parsed.cwd === 'string') aggregate.cwd = parsed.cwd;

  const timestamp = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN;
  if (!Number.isNaN(timestamp)) markActivity(aggregate, timestamp);

  if (parsed.type === 'cost-state') {
    applyCostState(aggregate, parsed);
    return;
  }

  if (parsed.type === 'assistant' && isRecord(parsed.message) && isRecord(parsed.message.usage)) {
    applyLiveUsage(aggregate, parsed.message.model, parsed.message.usage);
  }
}

function markActivity(aggregate: FileAggregate, timestamp: number): void {
  if (aggregate.startedAt === null || timestamp < aggregate.startedAt) {
    aggregate.startedAt = timestamp;
  }
  if (aggregate.lastActivityAt === null || timestamp > aggregate.lastActivityAt) {
    aggregate.lastActivityAt = timestamp;
  }
}

function applyCostState(aggregate: FileAggregate, parsed: Record<string, unknown>): void {
  if (typeof parsed.totalCostUSD === 'number') aggregate.totalCostUsd = parsed.totalCostUSD;
  aggregate.hasUnknownModelCost = Boolean(parsed.hasUnknownModelCost);
  if (typeof parsed.startTime === 'number') markActivity(aggregate, parsed.startTime);

  if (!isRecord(parsed.modelUsage)) return;
  const exact = new Map<string, ExactModelUsage>();
  for (const [model, raw] of Object.entries(parsed.modelUsage)) {
    if (!isRecord(raw)) continue;
    exact.set(model, {
      inputTokens: numberOr0(raw.inputTokens),
      outputTokens: numberOr0(raw.outputTokens),
      cacheReadInputTokens: numberOr0(raw.cacheReadInputTokens),
      cacheCreationInputTokens: numberOr0(raw.cacheCreationInputTokens),
      costUsd: typeof raw.costUSD === 'number' ? raw.costUSD : 0,
    });
  }
  aggregate.exactModels = exact;
}

function applyLiveUsage(aggregate: FileAggregate, modelValue: unknown, usage: unknown): void {
  const model = typeof modelValue === 'string' ? modelValue : 'unknown';
  if (!isRecord(usage)) return;
  const totals = aggregate.liveModels.get(model) ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  totals.inputTokens += numberOr0(usage.input_tokens);
  totals.outputTokens += numberOr0(usage.output_tokens);
  totals.cacheReadInputTokens += numberOr0(usage.cache_read_input_tokens);
  totals.cacheCreationInputTokens += numberOr0(usage.cache_creation_input_tokens);
  aggregate.liveModels.set(model, totals);
}

function toSessionUsage(file: string, aggregate: FileAggregate): ClaudeSessionUsage {
  const sessionId = aggregate.sessionId ?? path.basename(file, '.jsonl');
  const models: ClaudeModelUsage[] = aggregate.exactModels
    ? [...aggregate.exactModels.entries()].map(([model, usage]) => ({
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        costUsd: usage.costUsd,
        costSource: 'exact' as const,
      }))
    : [...aggregate.liveModels.entries()].map(([model, usage]) => {
        const estimated = estimateCostUsd(model, usage);
        return {
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          costUsd: estimated,
          costSource: estimated === null ? ('unavailable' as const) : ('estimated' as const),
        };
      });

  const totalCostUsd =
    aggregate.totalCostUsd ??
    (models.every((m) => m.costUsd !== null)
      ? models.reduce((sum, m) => sum + (m.costUsd ?? 0), 0)
      : null);
  const costSource: ClaudeSessionUsage['costSource'] =
    aggregate.totalCostUsd !== null ? 'exact' : totalCostUsd !== null ? 'estimated' : 'unavailable';

  return {
    sessionId,
    cwd: aggregate.cwd,
    startedAt: aggregate.startedAt,
    lastActivityAt: aggregate.lastActivityAt,
    totalCostUsd,
    costSource,
    hasUnknownModelCost: aggregate.hasUnknownModelCost,
    models,
  };
}
