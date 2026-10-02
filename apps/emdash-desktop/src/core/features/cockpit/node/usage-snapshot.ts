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

/** Phase 0 ships a single, unlabeled account per provider: the default config dir. */
const DEFAULT_ACCOUNT_ID = 'default';

export type UsageSnapshotInput = Readonly<{
  /** `null` means `CLAUDE_CONFIG_DIR` was never scanned (e.g. provider not detected). */
  claude: ClaudeUsageScan | null;
  codex: CodexUsageScan | null;
  now: number;
}>;

export function buildUsageSnapshot(input: UsageSnapshotInput): UsageSnapshot {
  const startOfDay = startOfLocalDay(input.now);

  const providers: UsageProvider[] = [];
  const sessionsToday: UsageSessionRow[] = [];

  if (input.claude) {
    const todaySessions = input.claude.sessions.filter((s) => isActiveToday(s, startOfDay));
    providers.push({
      providerId: 'claude',
      accounts: [buildClaudeAccount(todaySessions)],
    });
    for (const session of todaySessions) {
      sessionsToday.push(claudeSessionRow(session));
    }
  }

  if (input.codex) {
    const todaySessions = input.codex.sessions.filter((s) => isActiveToday(s, startOfDay));
    providers.push({
      providerId: 'codex',
      accounts: [buildCodexAccount(todaySessions, input.codex.latestRateLimits)],
    });
    for (const session of todaySessions) {
      sessionsToday.push(codexSessionRow(session));
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
  if (input.claude === null && input.codex === null) return 'unavailable';
  if (input.claude === null || input.codex === null) return 'partial';
  return 'exact';
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

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

function buildClaudeAccount(sessions: readonly ClaudeSessionUsage[]): UsageAccount {
  const modelsToday = mergeModelBreakdowns(
    sessions.flatMap((session) =>
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
    accountId: DEFAULT_ACCOUNT_ID,
    label: 'Claude',
    isDefault: true,
    // Local jsonl scanning never surfaces a rate-limit percentage; that
    // requires the opt-in OAuth usage endpoint (a later phase).
    rateLimits: { source: 'unavailable', fiveHour: null, weekly: null },
    modelsToday,
    costTodayUsd: costUsd,
    costSource,
  };
}

function claudeSessionRow(session: ClaudeSessionUsage): UsageSessionRow {
  const inputTokens = sum(session.models, (m) => m.inputTokens);
  const outputTokens = sum(session.models, (m) => m.outputTokens);
  const cacheTokens = sum(
    session.models,
    (m) => m.cacheReadInputTokens + m.cacheCreationInputTokens
  );
  return {
    provider: 'claude',
    accountId: DEFAULT_ACCOUNT_ID,
    accountLabel: 'Claude',
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
  sessions: readonly CodexSessionUsage[],
  latestRateLimits: CodexRateLimits | null
): UsageAccount {
  const modelsToday = mergeModelBreakdowns(
    sessions.flatMap((session) => {
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
    accountId: DEFAULT_ACCOUNT_ID,
    label: 'Codex',
    isDefault: true,
    rateLimits: toUsageRateLimits(latestRateLimits),
    modelsToday,
    costTodayUsd: costUsd,
    costSource,
  };
}

function toUsageRateLimits(rateLimits: CodexRateLimits | null): UsageRateLimits {
  if (!rateLimits) return { source: 'unavailable', fiveHour: null, weekly: null };
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

function codexSessionRow(session: CodexSessionUsage): UsageSessionRow {
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
    accountId: DEFAULT_ACCOUNT_ID,
    accountLabel: 'Codex',
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
