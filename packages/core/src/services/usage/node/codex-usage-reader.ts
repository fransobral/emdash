import { open, stat } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';

/**
 * Tail-scans `$CODEX_HOME/sessions/**\/rollout-*.jsonl` for usage data.
 *
 * Only the narrow fields needed for usage accounting are read: `type`,
 * `timestamp`, `payload.session_id`/`cwd`, `payload.model` (from
 * `turn_context`), the cumulative token counters, and `payload.rate_limits`
 * when present. Everything else in each line — including
 * `base_instructions`, tool calls, and message content — is discarded as
 * soon as the line is parsed. This file never touches `auth.json`.
 *
 * Two historically different event shapes are both handled, since the CLI
 * has shipped both during this project's observation window:
 *  - `event_msg` wrapping `payload.type === "token_count"`, with
 *    `payload.info.total_token_usage` and an optional `payload.rate_limits`.
 *  - top-level `type: "token_usage_record"`, with `payload.thread_token_usage`
 *    (cumulative for the thread) and no rate limit data.
 * `rate_limits` is frequently absent (behind proxies, reverted-thread
 * rollouts, or simply not emitted by the running CLI build) and must be
 * treated as the common case, not an error.
 */

export type CodexTokenTotals = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}>;

export type CodexSessionUsage = Readonly<{
  sessionId: string;
  cwd: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  /** Best-effort: the most recent model seen on a `turn_context` event for this session. */
  model: string | null;
  tokens: CodexTokenTotals | null;
}>;

/** One rate-limit window, classified by its duration rather than its slot name. */
export type CodexRateLimitWindow = Readonly<{
  usedPercent: number;
  windowMinutes: number;
  /** Epoch ms. */
  resetsAt: number | null;
}>;

export type CodexRateLimits = Readonly<{
  fiveHour: CodexRateLimitWindow | null;
  weekly: CodexRateLimitWindow | null;
  /** Epoch ms timestamp of the rollout line this snapshot came from. */
  observedAt: number;
}>;

export type CodexUsageScan = Readonly<{
  sessions: readonly CodexSessionUsage[];
  /** The single most recent rate-limit snapshot across every scanned session, if any. */
  latestRateLimits: CodexRateLimits | null;
}>;

/** Windows at or under this length are "five hour"; anything longer is "weekly". */
const FIVE_HOUR_CUTOFF_MINUTES = 360;

type FileAggregate = {
  sessionId: string | null;
  cwd: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  model: string | null;
  tokens: CodexTokenTotals | null;
  rateLimits: CodexRateLimits | null;
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
    model: null,
    tokens: null,
    rateLimits: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Reads usage from Codex's own on-disk rollout logs for one `CODEX_HOME`.
 * Keeps an in-memory per-file byte-offset cache, mirroring
 * {@link ../claude-usage-reader!ClaudeUsageReader}: a file already scanned is
 * never re-read from the start.
 */
export class CodexUsageReader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly configDir: string) {}

  async scan(sinceMs: number): Promise<CodexUsageScan> {
    const pattern = path.join(this.configDir, 'sessions', '**', 'rollout-*.jsonl');
    const files: string[] = [];
    try {
      for await (const file of glob(pattern)) files.push(file);
    } catch {
      return { sessions: [], latestRateLimits: null };
    }

    const seen = new Set<string>();
    const sessions: CodexSessionUsage[] = [];
    let latestRateLimits: CodexRateLimits | null = null;
    for (const file of files) {
      seen.add(file);
      const aggregate = await this.scanFile(file, sinceMs);
      if (!aggregate) continue;
      sessions.push(toSessionUsage(file, aggregate));
      if (
        aggregate.rateLimits &&
        (latestRateLimits === null || aggregate.rateLimits.observedAt > latestRateLimits.observedAt)
      ) {
        latestRateLimits = aggregate.rateLimits;
      }
    }

    for (const cachedPath of [...this.cache.keys()]) {
      if (!seen.has(cachedPath)) this.cache.delete(cachedPath);
    }

    return { sessions, latestRateLimits };
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
    lines.pop(); // trailing '' or an incomplete line not yet newline-terminated
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
  if (!isRecord(parsed) || !isRecord(parsed.payload)) return;
  const payload = parsed.payload;

  const lineTimestamp = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN;
  if (!Number.isNaN(lineTimestamp)) markActivity(aggregate, lineTimestamp);

  switch (parsed.type) {
    case 'session_meta':
      if (typeof payload.session_id === 'string') aggregate.sessionId = payload.session_id;
      if (typeof payload.cwd === 'string') aggregate.cwd = payload.cwd;
      break;
    case 'turn_context':
      if (typeof payload.model === 'string') aggregate.model = payload.model;
      break;
    case 'token_usage_record':
      if (typeof payload.session_id === 'string') aggregate.sessionId = payload.session_id;
      if (isRecord(payload.thread_token_usage)) {
        aggregate.tokens = toTokenTotals(payload.thread_token_usage);
      }
      break;
    case 'event_msg':
      applyEventMsg(aggregate, payload, lineTimestamp);
      break;
    default:
      break;
  }
}

function applyEventMsg(
  aggregate: FileAggregate,
  payload: Record<string, unknown>,
  lineTimestamp: number
): void {
  if (payload.type !== 'token_count') return;
  if (isRecord(payload.info) && isRecord(payload.info.total_token_usage)) {
    aggregate.tokens = toTokenTotals(payload.info.total_token_usage);
  }
  if (isRecord(payload.rate_limits)) {
    aggregate.rateLimits = toRateLimits(
      payload.rate_limits,
      lineTimestamp,
      aggregate.lastActivityAt
    );
  }
}

function toTokenTotals(raw: Record<string, unknown>): CodexTokenTotals {
  return {
    inputTokens: numberOr0(raw.input_tokens),
    cachedInputTokens: numberOr0(raw.cached_input_tokens),
    outputTokens: numberOr0(raw.output_tokens),
    reasoningOutputTokens: numberOr0(raw.reasoning_output_tokens),
    totalTokens: numberOr0(raw.total_tokens),
  };
}

function toRateLimits(
  raw: Record<string, unknown>,
  lineTimestamp: number,
  fallbackTimestamp: number | null
): CodexRateLimits {
  const observedAt = Number.isNaN(lineTimestamp) ? (fallbackTimestamp ?? 0) : lineTimestamp;
  let fiveHour: CodexRateLimitWindow | null = null;
  let weekly: CodexRateLimitWindow | null = null;
  for (const slot of [raw.primary, raw.secondary]) {
    if (!isRecord(slot)) continue;
    const window = toRateLimitWindow(slot);
    if (window === null) continue;
    if (window.windowMinutes <= FIVE_HOUR_CUTOFF_MINUTES) fiveHour = window;
    else weekly = window;
  }
  return { fiveHour, weekly, observedAt };
}

function toRateLimitWindow(raw: Record<string, unknown>): CodexRateLimitWindow | null {
  if (typeof raw.used_percent !== 'number' || typeof raw.window_minutes !== 'number') return null;
  const resetsAt = typeof raw.resets_at === 'number' ? raw.resets_at * 1000 : null;
  return { usedPercent: raw.used_percent, windowMinutes: raw.window_minutes, resetsAt };
}

function markActivity(aggregate: FileAggregate, timestamp: number): void {
  if (aggregate.startedAt === null || timestamp < aggregate.startedAt) {
    aggregate.startedAt = timestamp;
  }
  if (aggregate.lastActivityAt === null || timestamp > aggregate.lastActivityAt) {
    aggregate.lastActivityAt = timestamp;
  }
}

function toSessionUsage(file: string, aggregate: FileAggregate): CodexSessionUsage {
  return {
    sessionId: aggregate.sessionId ?? path.basename(file, '.jsonl'),
    cwd: aggregate.cwd,
    startedAt: aggregate.startedAt,
    lastActivityAt: aggregate.lastActivityAt,
    model: aggregate.model,
    tokens: aggregate.tokens,
  };
}
