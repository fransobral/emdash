/**
 * Thin, opt-in client for Anthropic's OAuth usage endpoint
 * (`GET /api/oauth/usage`). This endpoint is **undocumented and internal**
 * to Claude Code — confirmed only via community reports (e.g.
 * anthropics/claude-code#31021), not official docs. It can change shape or
 * disappear without notice, and calling it with the wrong headers has been
 * observed to land callers in an aggressive rate-limit bucket rather than a
 * clean error. Treat every response defensively and never let a failure
 * here affect the rest of the usage dashboard.
 */

export type ClaudeOAuthUsageWindow = Readonly<{
  usedPercent: number;
  /** Epoch ms, when the response includes a parseable reset time. */
  resetsAt: number | null;
}>;

export type ClaudeOAuthUsageSnapshot = Readonly<{
  fiveHour: ClaudeOAuthUsageWindow | null;
  weekly: ClaudeOAuthUsageWindow | null;
  /** Epoch ms of the last successful fetch this snapshot reflects. */
  fetchedAt: number;
  /** True when served from cache during a backoff window, not a fresh fetch. */
  stale: boolean;
}>;

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
/**
 * Required to avoid the aggressive rate-limit bucket mentioned above.
 * Best-effort shape of Claude Code's own headers; may need updating if
 * Anthropic changes what it checks.
 */
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const USER_AGENT = 'claude-cli/1.0.0 (external, cli)';

/** "≤ 1x/5min per account" from the usage dashboard's polling design. */
const CACHE_TTL_MS = 5 * 60_000;
const INITIAL_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;

type FetchResponseLike = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
type FetchLike = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<FetchResponseLike>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseWindow(value: unknown): ClaudeOAuthUsageWindow | null {
  if (!isRecord(value)) return null;
  const usedPercent = value.utilization;
  if (typeof usedPercent !== 'number') return null;
  const resetsAtRaw = value.resets_at;
  const resetsAt = typeof resetsAtRaw === 'string' ? Date.parse(resetsAtRaw) : NaN;
  return { usedPercent, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt };
}

/**
 * One instance per account. Keeps its own 5-minute cache and exponential
 * backoff so that even if `getUsage` is called on every local poll tick,
 * the account is only actually hit over the network at most once every 5
 * minutes (less often while backing off from a 429/5xx). Never throws:
 * every failure degrades to the last-known value marked `stale`, or `null`
 * if nothing has ever succeeded.
 */
export class ClaudeOAuthUsageClient {
  private cached: { value: ClaudeOAuthUsageSnapshot; fetchedAt: number } | null = null;
  private nextAllowedAt = 0;
  private backoffMs = INITIAL_BACKOFF_MS;

  constructor(private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  async getUsage(
    accessToken: string,
    now: number = Date.now()
  ): Promise<ClaudeOAuthUsageSnapshot | null> {
    if (this.cached && now - this.cached.fetchedAt < CACHE_TTL_MS) {
      return this.cached.value;
    }
    if (now < this.nextAllowedAt) {
      return this.staleOrNull();
    }

    try {
      const response = await this.fetchImpl(USAGE_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
          'User-Agent': USER_AGENT,
        },
      });

      if (response.status === 429 || response.status >= 500) {
        this.registerFailure(now);
        return this.staleOrNull();
      }
      if (!response.ok) {
        // Non-retryable (401/403/...): degrade without entering backoff —
        // the account's own token may simply need the CLI to refresh it.
        return this.staleOrNull();
      }

      const body: unknown = await response.json();
      const snapshot: ClaudeOAuthUsageSnapshot = {
        fiveHour: parseWindow(isRecord(body) ? body.five_hour : undefined),
        weekly: parseWindow(isRecord(body) ? body.seven_day : undefined),
        fetchedAt: now,
        stale: false,
      };
      this.cached = { value: snapshot, fetchedAt: now };
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.nextAllowedAt = 0;
      return snapshot;
    } catch {
      this.registerFailure(now);
      return this.staleOrNull();
    }
  }

  private staleOrNull(): ClaudeOAuthUsageSnapshot | null {
    if (!this.cached) return null;
    return { ...this.cached.value, stale: true };
  }

  private registerFailure(now: number): void {
    this.nextAllowedAt = now + this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }
}
