/**
 * Tracks whether Codex ACP sessions should be launched against a fallback
 * `CODEX_HOME` because the primary ChatGPT account recently hit its usage
 * limit. In-memory only: a restart returns to the default home.
 *
 * Disabled entirely (every method is a no-op / returns `undefined`) unless a
 * fallback home was configured at runtime construction.
 */

const CODEX_PROVIDER_ID = 'codex';

export class CodexFallbackState {
  private resetAt: number | null = null;

  constructor(private readonly fallbackHome: string | undefined) {}

  /** True when a fallback `CODEX_HOME` was configured for this runtime. */
  get configured(): boolean {
    return this.fallbackHome !== undefined;
  }

  /** Activates (or extends) the fallback window until `resetAt`. No-op when unconfigured. */
  activate(resetAt: number): void {
    if (!this.configured) return;
    this.resetAt = resetAt;
  }

  /** True while the fallback window is active, i.e. `now` is before the last known reset time. */
  isActive(now: number): boolean {
    return this.configured && this.resetAt !== null && now < this.resetAt;
  }

  /**
   * The env overlay to apply when launching `providerId`, or `undefined` when no
   * overlay applies (unconfigured, not Codex, or the fallback window has expired).
   */
  envOverlay(providerId: string, now: number): Readonly<Record<string, string>> | undefined {
    if (providerId !== CODEX_PROVIDER_ID || !this.isActive(now)) return undefined;
    return { CODEX_HOME: this.fallbackHome as string };
  }
}
