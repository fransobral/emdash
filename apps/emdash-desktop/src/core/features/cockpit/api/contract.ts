import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

/**
 * Every number in the Hoy usage dashboard is labeled with where it came
 * from, instead of blending exact and estimated figures into one unlabeled
 * total:
 *  - `exact`: read from the provider's own local bookkeeping (Claude Code's
 *    `cost-state` summary, Codex's cumulative token counters) or, in a later
 *    phase, the account's own rate-limit API.
 *  - `estimated`: computed from token counts against a static price table
 *    because no exact figure was available yet.
 *  - `unavailable`: neither an exact nor an estimated figure exists (e.g. an
 *    unrecognized model, or a signal the provider never reports).
 */
export const usageValueSourceSchema = z.enum(['exact', 'estimated', 'unavailable']);
export type UsageValueSource = z.infer<typeof usageValueSourceSchema>;

export const usageProviderIdSchema = z.enum(['claude', 'codex']);
export type UsageProviderId = z.infer<typeof usageProviderIdSchema>;

export const usageModelBreakdownSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheTokens: z.number(),
  costUsd: z.number().nullable(),
  costSource: usageValueSourceSchema,
});
export type UsageModelBreakdown = z.infer<typeof usageModelBreakdownSchema>;

export const usageRateLimitWindowSchema = z.object({
  usedPercent: z.number(),
  /** Epoch ms local reset time, when the provider reports one. */
  resetsAt: z.number().nullable(),
});
export type UsageRateLimitWindow = z.infer<typeof usageRateLimitWindowSchema>;

export const usageRateLimitsSchema = z.object({
  source: usageValueSourceSchema,
  fiveHour: usageRateLimitWindowSchema.nullable(),
  weekly: usageRateLimitWindowSchema.nullable(),
});
export type UsageRateLimits = z.infer<typeof usageRateLimitsSchema>;

export const usageAccountSchema = z.object({
  accountId: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  rateLimits: usageRateLimitsSchema,
  modelsToday: z.array(usageModelBreakdownSchema),
  costTodayUsd: z.number().nullable(),
  costSource: usageValueSourceSchema,
});
export type UsageAccount = z.infer<typeof usageAccountSchema>;

export const usageProviderSchema = z.object({
  providerId: usageProviderIdSchema,
  accounts: z.array(usageAccountSchema),
});
export type UsageProvider = z.infer<typeof usageProviderSchema>;

export const usageSessionRowSchema = z.object({
  provider: usageProviderIdSchema,
  accountId: z.string(),
  accountLabel: z.string(),
  sessionId: z.string(),
  model: z.string().nullable(),
  cwd: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheTokens: z.number(),
  startedAt: z.number().nullable(),
  lastActivityAt: z.number().nullable(),
  costUsd: z.number().nullable(),
  costSource: usageValueSourceSchema,
});
export type UsageSessionRow = z.infer<typeof usageSessionRowSchema>;

export const usageSnapshotSchema = z.object({
  generatedAt: z.number(),
  /** Whole-dashboard fallback: true only when no provider directory was found at all. */
  availability: z.enum(['exact', 'partial', 'unavailable']),
  providers: z.array(usageProviderSchema),
  sessionsToday: z.array(usageSessionRowSchema),
});
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

export const cockpitDomain = 'cockpit' as const;

export const cockpitContract = defineContract({
  /**
   * One local-file scan snapshot of today's usage across every configured
   * account. Poll-driven like `devPerf.processSnapshot`: the main process
   * only tail-scans files when the Hoy view asks, and the reader's own
   * byte-offset cache keeps repeated polls cheap.
   */
  usageSnapshot: procedure({
    input: z.void(),
    output: usageSnapshotSchema,
  }),
});

export type CockpitContract = typeof cockpitContract;
