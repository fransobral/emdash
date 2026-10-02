import type {
  ClaudeSessionUsage,
  ClaudeUsageScan,
  CodexRateLimits,
  CodexSessionUsage,
  CodexUsageScan,
} from '@emdash/core/services/usage/node';
import { estimateCostUsd } from '@emdash/core/services/usage/node';
import type {
  UsageAccount,
  UsageModelBreakdown,
  UsageProvider,
  UsageRateLimits,
  UsageSessionRow,
  UsageSnapshot,
  UsageValueSource,
} from '../api/contract';

/** One linked account's scan result; `scan` is `null` when its config dir was never read. */
export type UsageAccountScan<TScan> = Readonly<{
  accountId: string;
  label: string;
  isDefault: boolean;
  scan: TScan | null;
}>;

export type UsageSnapshotInput = Readonly<{
  claude: readonly UsageAccountScan<ClaudeUsageScan>[];
  codex: readonly UsageAccountScan<CodexUsageScan>[];
  now: number;
}>;

export function buildUsageSnapshot(input: UsageSnapshotInput): UsageSnapshot {
  const startOfDay = startOfLocalDay(input.now);

  const providers: UsageProvider[] = [];
  const sessionsToday: UsageSessionRow[] = [];

  if (input.claude.length > 0) {
    providers.push({
      providerId: 'claude',
      accounts: input.claude.map((account) => buildClaudeAccount(account, startOfDay)),
    });
    for (const account of input.claude) {
      if (!account.scan) continue;
      for (const session of account.scan.sessions.filter((s) => isActiveToday(s, startOfDay))) {
        sessionsToday.push(claudeSessionRow(session, account));
      }
    }
  }

  if (input.codex.length > 0) {
    providers.push({
      providerId: 'codex',
      accounts: input.codex.map((account) => buildCodexAccount(account, startOfDay)),
    });
    for (const account of input.codex) {
      if (!account.scan) continue;
      for (const session of account.scan.sessions.filter((s) => isActiveToday(s, startOfDay))) {
        sessionsToday.push(codexSessionRow(session, account));
      }
    }
  }

  sessionsToday.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

  return {
    generatedAt: input.now,
    availability: resolveAvailability(input),
    providers,
    sessionsToday,
  };
}

function resolveAvailability(input: UsageSnapshotInput): UsageSnapshot['availability'] {
  const accounts = [...input.claude, ...input.codex];
  if (accounts.length === 0) return 'unavailable';
  const scanned = accounts.filter((a) => a.scan !== null).length;
  if (scanned === 0) return 'unavailable';
  if (scanned === accounts.length) return 'exact';
  return 'partial';
}

export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function isActiveToday(
  session: { startedAt: number | null; lastActivityAt: number | null },
  startOfDay: number
): boolean {
  const activity = session.lastActivityAt ?? session.startedAt;
  return activity !== null && activity >= startOfDay;
}

const UNAVAILABLE_RATE_LIMITS: UsageRateLimits = {
  source: 'unavailable',
  fiveHour: null,
  weekly: null,
};

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

function buildClaudeAccount(
  account: UsageAccountScan<ClaudeUsageScan>,
  startOfDay: number
): UsageAccount {
  if (!account.scan) return emptyAccount(account);

  const todaySessions = account.scan.sessions.filter((s) => isActiveToday(s, startOfDay));
  const modelsToday = mergeModelBreakdowns(
    todaySessions.flatMap((session) =>
      session.models.map((model) => ({
        model: model.model,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cacheTokens: model.cacheReadInputTokens + model.cacheCreationInputTokens,
        costUsd: model.costUsd,
        costSource: model.costSource,
      }))
    )
  );
  const { costUsd, costSource } = totalCost(modelsToday);

  return {
    accountId: account.accountId,
    label: account.label,
    isDefault: account.isDefault,
    // Local jsonl scanning never surfaces a rate-limit percentage; that
    // requires the opt-in OAuth usage endpoint (a later phase).
    rateLimits: UNAVAILABLE_RATE_LIMITS,
    modelsToday,
    costTodayUsd: costUsd,
    costSource,
  };
}

function claudeSessionRow(
  session: ClaudeSessionUsage,
  account: UsageAccountScan<ClaudeUsageScan>
): UsageSessionRow {
  const inputTokens = sum(session.models, (m) => m.inputTokens);
  const outputTokens = sum(session.models, (m) => m.outputTokens);
  const cacheTokens = sum(
    session.models,
    (m) => m.cacheReadInputTokens + m.cacheCreationInputTokens
  );
  return {
    provider: 'claude',
    accountId: account.accountId,
    accountLabel: account.label,
    sessionId: session.sessionId,
    // A session can use more than one model; the busiest one represents the row.
    model: busiestModel(session.models)?.model ?? null,
    cwd: session.cwd,
    inputTokens,
    outputTokens,
    cacheTokens,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    costUsd: session.totalCostUsd,
    costSource: session.costSource,
  };
}

function busiestModel(
  models: readonly { model: string; inputTokens: number; outputTokens: number }[]
) {
  return models.reduce<(typeof models)[number] | null>((best, candidate) => {
    if (!best) return candidate;
    const bestTokens = best.inputTokens + best.outputTokens;
    const candidateTokens = candidate.inputTokens + candidate.outputTokens;
    return candidateTokens > bestTokens ? candidate : best;
  }, null);
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

function buildCodexAccount(
  account: UsageAccountScan<CodexUsageScan>,
  startOfDay: number
): UsageAccount {
  if (!account.scan) return emptyAccount(account);

  const todaySessions = account.scan.sessions.filter((s) => isActiveToday(s, startOfDay));
  const modelsToday = mergeModelBreakdowns(
    todaySessions.flatMap((session) => {
      if (!session.tokens || !session.model) return [];
      const cacheTokens = session.tokens.cachedInputTokens;
      const costUsd = estimateCostUsd(session.model, {
        inputTokens: session.tokens.inputTokens,
        outputTokens: session.tokens.outputTokens,
      });
      return [
        {
          model: session.model,
          inputTokens: session.tokens.inputTokens,
          outputTokens: session.tokens.outputTokens,
          cacheTokens,
          costUsd,
          costSource: (costUsd === null ? 'unavailable' : 'estimated') as UsageValueSource,
        },
      ];
    })
  );
  const { costUsd, costSource } = totalCost(modelsToday);

  return {
    accountId: account.accountId,
    label: account.label,
    isDefault: account.isDefault,
    rateLimits: toUsageRateLimits(account.scan.latestRateLimits),
    modelsToday,
    costTodayUsd: costUsd,
    costSource,
  };
}

function toUsageRateLimits(rateLimits: CodexRateLimits | null): UsageRateLimits {
  if (!rateLimits) return UNAVAILABLE_RATE_LIMITS;
  return {
    source: 'exact',
    fiveHour: rateLimits.fiveHour
      ? { usedPercent: rateLimits.fiveHour.usedPercent, resetsAt: rateLimits.fiveHour.resetsAt }
      : null,
    weekly: rateLimits.weekly
      ? { usedPercent: rateLimits.weekly.usedPercent, resetsAt: rateLimits.weekly.resetsAt }
      : null,
  };
}

function codexSessionRow(
  session: CodexSessionUsage,
  account: UsageAccountScan<CodexUsageScan>
): UsageSessionRow {
  const tokens = session.tokens;
  const costUsd =
    tokens && session.model
      ? estimateCostUsd(session.model, {
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
        })
      : null;
  return {
    provider: 'codex',
    accountId: account.accountId,
    accountLabel: account.label,
    sessionId: session.sessionId,
    model: session.model,
    cwd: session.cwd,
    inputTokens: tokens?.inputTokens ?? 0,
    outputTokens: tokens?.outputTokens ?? 0,
    cacheTokens: tokens?.cachedInputTokens ?? 0,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    costUsd,
    costSource: costUsd === null ? 'unavailable' : 'estimated',
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** An account whose config dir was never scanned: "no disponible" per item, never hidden. */
function emptyAccount(account: UsageAccountScan<unknown>): UsageAccount {
  return {
    accountId: account.accountId,
    label: account.label,
    isDefault: account.isDefault,
    rateLimits: UNAVAILABLE_RATE_LIMITS,
    modelsToday: [],
    costTodayUsd: null,
    costSource: 'unavailable',
  };
}

function mergeModelBreakdowns(entries: readonly UsageModelBreakdown[]): UsageModelBreakdown[] {
  const byModel = new Map<string, UsageModelBreakdown>();
  for (const entry of entries) {
    const existing = byModel.get(entry.model);
    if (!existing) {
      byModel.set(entry.model, { ...entry });
      continue;
    }
    byModel.set(entry.model, {
      model: entry.model,
      inputTokens: existing.inputTokens + entry.inputTokens,
      outputTokens: existing.outputTokens + entry.outputTokens,
      cacheTokens: existing.cacheTokens + entry.cacheTokens,
      costUsd:
        existing.costUsd === null && entry.costUsd === null
          ? null
          : (existing.costUsd ?? 0) + (entry.costUsd ?? 0),
      costSource: weakestSource(existing.costSource, entry.costSource),
    });
  }
  return [...byModel.values()];
}

function weakestSource(a: UsageValueSource, b: UsageValueSource): UsageValueSource {
  const rank: Record<UsageValueSource, number> = { exact: 2, estimated: 1, unavailable: 0 };
  return rank[a] <= rank[b] ? a : b;
}

function totalCost(models: readonly UsageModelBreakdown[]): {
  costUsd: number | null;
  costSource: UsageValueSource;
} {
  if (models.length === 0) return { costUsd: null, costSource: 'unavailable' };
  const known = models.filter((m) => m.costUsd !== null);
  if (known.length === 0) return { costUsd: null, costSource: 'unavailable' };
  const costUsd = sum(known, (m) => m.costUsd ?? 0);
  const costSource = models.every((m) => m.costSource === 'exact') ? 'exact' : 'estimated';
  return { costUsd, costSource };
}

function sum<T>(items: readonly T[], project: (item: T) => number): number {
  return items.reduce((total, item) => total + project(item), 0);
}
