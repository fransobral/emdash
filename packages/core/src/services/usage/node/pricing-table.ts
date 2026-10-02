/**
 * Static, dated $/MTok price table used only to *estimate* cost for usage
 * signals that do not already carry an exact, provider-reported cost (Codex
 * token events never do; Claude sessions usually do via their own
 * `cost-state` summary, so this table is a fallback for Claude too).
 *
 * No network calls. Prices are list prices as published by each provider at
 * the time this table was last updated (see `PRICING_TABLE_UPDATED_AT`).
 * Unknown or newly released models intentionally resolve to `null` rather
 * than a guessed number — a wrong estimate is worse than an honest
 * "no disponible", per the dashboard's exact-vs-estimated rule.
 */

/** ISO date this table's prices were last verified against provider docs. */
export const PRICING_TABLE_UPDATED_AT = '2025-10-01';

export type ModelPrice = Readonly<{
  /** $ per million input tokens (cache-miss / regular input). */
  inputPerMTok: number;
  /** $ per million output tokens. */
  outputPerMTok: number;
  /** $ per million cache-read input tokens, when the provider prices it separately. */
  cacheReadPerMTok?: number;
  /** $ per million cache-write (cache creation) input tokens. */
  cacheWritePerMTok?: number;
}>;

export type UsageTokens = Readonly<{
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}>;

// Prices below are list prices for stable, named model families. Entries are
// matched by prefix against the model id seen in usage logs (e.g.
// "claude-sonnet-4-5-20250929" matches the "claude-sonnet-4-5" entry).
const PRICING_TABLE: ReadonlyArray<readonly [prefix: string, price: ModelPrice]> = [
  [
    'claude-opus-4',
    { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 },
  ],
  [
    'claude-sonnet-4',
    { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  ],
  [
    'claude-haiku-4-5',
    { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
  ],
  [
    'claude-3-5-haiku',
    { inputPerMTok: 0.8, outputPerMTok: 4, cacheReadPerMTok: 0.08, cacheWritePerMTok: 1 },
  ],
];

/** Finds the price entry for a model id by longest-prefix match, or `null` if unknown. */
export function lookupModelPrice(model: string): ModelPrice | null {
  const normalized = model.toLowerCase();
  let best: ModelPrice | null = null;
  let bestLength = -1;
  for (const [prefix, price] of PRICING_TABLE) {
    if (normalized.startsWith(prefix) && prefix.length > bestLength) {
      best = price;
      bestLength = prefix.length;
    }
  }
  return best;
}

/** Estimates USD cost for a token breakdown, or `null` when the model has no known price. */
export function estimateCostUsd(model: string, tokens: UsageTokens): number | null {
  const price = lookupModelPrice(model);
  if (!price) return null;
  const perToken = (count: number, perMTok: number) => (count / 1_000_000) * perMTok;
  let total = perToken(tokens.inputTokens, price.inputPerMTok);
  total += perToken(tokens.outputTokens, price.outputPerMTok);
  if (tokens.cacheReadInputTokens) {
    total += perToken(tokens.cacheReadInputTokens, price.cacheReadPerMTok ?? price.inputPerMTok);
  }
  if (tokens.cacheCreationInputTokens) {
    total += perToken(
      tokens.cacheCreationInputTokens,
      price.cacheWritePerMTok ?? price.inputPerMTok
    );
  }
  return total;
}
