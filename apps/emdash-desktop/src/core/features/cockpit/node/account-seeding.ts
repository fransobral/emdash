import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Logger } from '@emdash/shared/logger';
import type { ProviderAccountStore } from '@core/services/provider-accounts/api/provider-account-store';
import type { UsageProviderId } from '../api/contract';

export type SeedAccountSpec = Readonly<{
  providerId: UsageProviderId;
  accountId: string;
  label: string;
  configDirPath: string;
}>;

/** Same env vars already allow-listed for provider process spawning. */
export function detectSeedAccounts(env: NodeJS.ProcessEnv = process.env): SeedAccountSpec[] {
  const home = homedir();
  const specs: SeedAccountSpec[] = [
    {
      providerId: 'claude',
      accountId: 'default',
      label: 'Claude',
      configDirPath: env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, '.claude'),
    },
    {
      providerId: 'codex',
      accountId: 'default',
      label: 'Codex',
      configDirPath: env.CODEX_HOME?.trim() || path.join(home, '.codex'),
    },
  ];

  // Mirrors the ACP runtime's Codex usage-limit fallback home resolution.
  const fallbackHome = env.EMDASH_CODEX_FALLBACK_HOME?.trim();
  if (fallbackHome) {
    specs.push({
      providerId: 'codex',
      accountId: 'fallback',
      label: 'Codex (respaldo)',
      configDirPath: fallbackHome,
    });
  }

  return specs;
}

/**
 * Seeds the detected local CLI accounts once, idempotently: an account is
 * only created when its directory exists on this machine and no account
 * with that provider/accountId has ever been registered. A user who
 * removes a seeded account keeps it removed for the rest of this process's
 * lifetime — it is only re-seeded across an app restart, when the registry
 * has no memory of the removal.
 */
export async function ensureSeededAccounts(
  store: Pick<ProviderAccountStore, 'getAccount' | 'upsertAccount'>,
  logger: Logger,
  specs: readonly SeedAccountSpec[] = detectSeedAccounts(),
  fsExists: (candidate: string) => boolean = existsSync
): Promise<void> {
  for (const spec of specs) {
    if (!fsExists(spec.configDirPath)) continue;
    try {
      const existing = await store.getAccount(spec.providerId, spec.accountId);
      if (existing) continue;
      await store.upsertAccount({
        providerId: spec.providerId,
        accountId: spec.accountId,
        meta: { label: spec.label, configDirPath: spec.configDirPath, credentialSource: 'cli' },
      });
    } catch (error) {
      logger.warn('cockpit: failed to seed usage account', { spec, error });
    }
  }
}
