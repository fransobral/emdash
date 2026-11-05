import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { UsageRateLimits } from '../api/contract';

export type CodexAccountUsage = {
  email: string | null;
  plan: string | null;
  rateLimits: UsageRateLimits;
  usageAllowed: boolean | null;
  blockedReason: string | null;
};
type AccountRead = (home: string) => Promise<{ account: unknown; limits: unknown }>;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function parseCodexAccountUsage(
  accountValue: unknown,
  limitsValue: unknown,
  now: number
): CodexAccountUsage {
  const account = record(record(accountValue).account);
  const limits = record(limitsValue);
  const buckets = record(limits.rateLimitsByLimitId);
  const rate = record(buckets.codex ?? limits.rateLimits);
  const rateLimits: UsageRateLimits = {
    source: 'exact',
    fiveHour: null,
    weekly: null,
    stale: false,
    observedAt: now,
    origin: 'live',
  };
  for (const raw of [rate.primary, rate.secondary]) {
    const slot = record(raw);
    if (
      typeof slot.usedPercent !== 'number' ||
      !Number.isFinite(slot.usedPercent) ||
      typeof slot.windowDurationMins !== 'number'
    )
      continue;
    const window = {
      usedPercent: slot.usedPercent,
      resetsAt: typeof slot.resetsAt === 'number' ? slot.resetsAt * 1000 : null,
    };
    if (slot.windowDurationMins <= 360) rateLimits.fiveHour = window;
    else rateLimits.weekly = window;
  }
  return {
    email: typeof account.email === 'string' ? account.email : null,
    plan: typeof account.planType === 'string' ? account.planType : null,
    rateLimits,
    usageAllowed:
      typeof limits.ordinaryUsageAllowed === 'boolean' ? limits.ordinaryUsageAllowed : null,
    blockedReason: typeof rate.rateLimitReachedType === 'string' ? rate.rateLimitReachedType : null,
  };
}

/** Read-only app-server requests. No thread, login, reset, or model request is issued. */
async function readAccount(home: string): Promise<{ account: unknown; limits: unknown }> {
  const child = spawn('codex', ['app-server'], {
    env: { ...process.env, CODEX_HOME: home },
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    shell: false,
  });
  const lines = createInterface({ input: child.stdout });
  let id = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const fail = () => {
    for (const request of pending.values())
      request.reject(new Error('No se pudieron leer los límites de Codex.'));
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', fail);
  child.stdin.on('error', fail);
  const timeout = setTimeout(() => {
    fail();
    child.kill();
  }, 15_000);
  lines.on('line', (line) => {
    try {
      const response = record(JSON.parse(line));
      if (typeof response.id !== 'number') return;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) request.reject(new Error('No se pudieron leer los límites de Codex.'));
      else request.resolve(response.result);
    } catch {
      /* Ignore non-protocol diagnostics without logging their contents. */
    }
  });
  const call = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n', (error) => {
        if (error) fail();
      });
    });
  try {
    await call('initialize', { clientInfo: { name: 'emdash-usage', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const account = await call('account/read', { refreshToken: false });
    const limits = await call('account/rateLimits/read', {});
    return { account, limits };
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.kill();
  }
}

/** One bounded read per account per five minutes, including failed requests. */
export class CodexAccountUsageClient {
  private readonly cache = new Map<
    string,
    { nextReadAt: number; value: CodexAccountUsage | null }
  >();
  private readonly pending = new Map<string, Promise<CodexAccountUsage | null>>();
  constructor(private readonly read: AccountRead = readAccount) {}

  async getUsage(home: string, now: number): Promise<CodexAccountUsage | null> {
    const pending = this.pending.get(home);
    if (pending) return pending;
    const cached = this.cache.get(home);
    if (cached && now < cached.nextReadAt) return cached.value;
    const promise = this.read(home)
      .then(({ account, limits }) => parseCodexAccountUsage(account, limits, now))
      .catch(() =>
        cached?.value
          ? { ...cached.value, rateLimits: { ...cached.value.rateLimits, stale: true } }
          : null
      )
      .then((value) => {
        this.cache.set(home, { nextReadAt: now + 5 * 60_000, value });
        this.pending.delete(home);
        return value;
      });
    this.pending.set(home, promise);
    return promise;
  }
}
