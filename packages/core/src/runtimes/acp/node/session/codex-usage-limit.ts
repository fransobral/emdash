/**
 * Detects a Codex "usage limit exceeded" failure reported through an ACP
 * `session/prompt` error, and parses the provider's reset time out of its
 * human-readable message.
 *
 * codex-acp fails the prompt with `RequestError.internalError(data)` where
 * `data.codexErrorInfo === 'usageLimitExceeded'` and `data.message` holds
 * text like:
 *   "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage
 *    to purchase more credits or try again at Oct 3rd, 2026 2:10 PM."
 */

export interface UsageLimitDetection {
  /** Epoch ms when the fallback should stop being used. */
  resetAt: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

const USAGE_LIMIT_PHRASE = /hit your usage limit/i;

const RESET_AT_PATTERN =
  /try again at\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;

const MONTH_INDEX_BY_ABBREVIATION: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Returns a non-null detection when `error` looks like a Codex usage-limit
 * failure. `now` is injected for deterministic tests.
 */
export function detectUsageLimit(error: unknown, now: number): UsageLimitDetection | null {
  if (typeof error !== 'object' || error === null) return null;
  const err = error as { data?: unknown; message?: unknown };
  const data =
    typeof err.data === 'object' && err.data !== null
      ? (err.data as Record<string, unknown>)
      : undefined;
  const codexErrorInfo = data?.codexErrorInfo;
  const dataMessage = typeof data?.message === 'string' ? data.message : undefined;
  const topMessage = typeof err.message === 'string' ? err.message : undefined;

  const isUsageLimit =
    codexErrorInfo === 'usageLimitExceeded' ||
    USAGE_LIMIT_PHRASE.test(dataMessage ?? '') ||
    USAGE_LIMIT_PHRASE.test(topMessage ?? '');
  if (!isUsageLimit) return null;

  return { resetAt: parseResetAt(dataMessage ?? topMessage ?? '', now) };
}

function parseResetAt(message: string, now: number): number {
  const fallback = now + ONE_HOUR_MS;
  const match = RESET_AT_PATTERN.exec(message);
  if (!match) return fallback;
  const [, monthName, dayText, yearText, hourText, minuteText, meridiem] = match;
  const monthIndex = MONTH_INDEX_BY_ABBREVIATION[monthName.slice(0, 3).toLowerCase()];
  if (monthIndex === undefined) return fallback;

  const day = Number(dayText);
  const year = Number(yearText);
  const minute = Number(minuteText);
  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === 'PM') hour += 12;

  const parsed = new Date(year, monthIndex, day, hour, minute, 0, 0).getTime();
  if (Number.isNaN(parsed) || parsed <= now) return fallback;
  return parsed;
}
