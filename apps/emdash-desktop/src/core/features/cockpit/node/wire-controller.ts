import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ClaudeUsageScan, CodexUsageScan } from '@emdash/core/services/usage/node';
import { ClaudeUsageReader, CodexUsageReader } from '@emdash/core/services/usage/node';
import { err, ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { createController, type Controller } from '@emdash/wire/rpc';
import type { ProviderAccountStore } from '@core/services/provider-accounts/api/provider-account-store';
import { cockpitContract, type UsageProviderId } from '../api/contract';
import { toLinkedAccount } from './account-linking';
import { ensureSeededAccounts } from './account-seeding';
import { buildUsageSnapshot, startOfLocalDay, type UsageAccountScan } from './usage-snapshot';

type AnyUsageScan = ClaudeUsageScan | CodexUsageScan;
type AnyUsageReader = { scan(sinceMs: number): Promise<AnyUsageScan> };

export function createCockpitWireController(
  logger: Logger,
  accountStore: ProviderAccountStore
): Controller {
  // Runs once per wire-controller lifetime (effectively at app bootstrap).
  // Never blocks controller creation — every handler below awaits this
  // same promise first, so the very first real RPC call still sees the
  // seeded accounts without a separate blocking bootstrap phase.
  const seeded = ensureSeededAccounts(accountStore, logger).catch((error) => {
    logger.warn('cockpit: account seeding failed', { error });
  });

  const readers = new Map<string, AnyUsageReader>();
  const readerFor = (providerId: UsageProviderId, accountId: string, configDirPath: string) => {
    const key = `${providerId}:${accountId}:${configDirPath}`;
    let reader = readers.get(key);
    if (!reader) {
      reader =
        providerId === 'claude'
          ? new ClaudeUsageReader(configDirPath)
          : new CodexUsageReader(configDirPath);
      readers.set(key, reader);
    }
    return reader;
  };

  async function scanAccounts<TScan extends AnyUsageScan>(
    providerId: UsageProviderId,
    since: number
  ): Promise<UsageAccountScan<TScan>[]> {
    const accounts = await accountStore.listAccounts(providerId);
    return Promise.all(
      accounts.map(async (account): Promise<UsageAccountScan<TScan>> => {
        const configDirPath = account.meta?.configDirPath ?? '';
        const label = account.meta?.label ?? account.meta?.fallbackDisplayName ?? account.accountId;
        const scan = await scanOrNull<TScan>(
          configDirPath,
          () =>
            readerFor(providerId, account.accountId, configDirPath).scan(since) as Promise<TScan>,
          logger
        );
        return { accountId: account.accountId, label, isDefault: account.isDefault, scan };
      })
    );
  }

  return createController(cockpitContract, {
    usageSnapshot: async () => {
      await seeded;
      const now = Date.now();
      const since = startOfLocalDay(now);
      const [claude, codex] = await Promise.all([
        scanAccounts<ClaudeUsageScan>('claude', since),
        scanAccounts<CodexUsageScan>('codex', since),
      ]);
      return buildUsageSnapshot({ claude, codex, now });
    },

    linkedAccounts: async () => {
      await seeded;
      const [claude, codex] = await Promise.all([
        accountStore.listAccounts('claude'),
        accountStore.listAccounts('codex'),
      ]);
      return [...claude, ...codex].map((account) => toLinkedAccount(account));
    },

    addUsageAccount: async (input) => {
      try {
        const configDirPath = expandHome(input.configDirPath.trim());
        const result = await accountStore.upsertAccount({
          providerId: input.providerId,
          accountId: randomUUID(),
          meta: { label: input.label.trim(), configDirPath, credentialSource: 'cli' },
        });
        return ok(toLinkedAccount(result.account));
      } catch (error) {
        logger.error('cockpit: failed to add usage account', { error });
        return err({ message: 'No pudimos guardar la cuenta.' });
      }
    },

    renameUsageAccount: async (input) => {
      try {
        const existing = await accountStore.getAccount(input.providerId, input.accountId);
        if (!existing) return err({ message: 'No encontramos esa cuenta.' });
        const { version: _version, ...meta } = existing.meta ?? {};
        const result = await accountStore.upsertAccount({
          providerId: input.providerId,
          accountId: input.accountId,
          meta: { ...meta, label: input.label.trim() },
        });
        return ok(toLinkedAccount(result.account));
      } catch (error) {
        logger.error('cockpit: failed to rename usage account', { error });
        return err({ message: 'No pudimos renombrar la cuenta.' });
      }
    },

    removeUsageAccount: async (input) => {
      try {
        const removed = await accountStore.removeAccount(input.providerId, input.accountId);
        return ok({ removed: removed !== null });
      } catch (error) {
        logger.error('cockpit: failed to remove usage account', { error });
        return err({ message: 'No pudimos quitar la cuenta.' });
      }
    },
  });
}

function expandHome(configDirPath: string): string {
  if (configDirPath === '~') return homedir();
  if (configDirPath.startsWith('~/')) return homedir() + configDirPath.slice(1);
  return configDirPath;
}

/**
 * Returns `null` when the provider's config dir does not exist at all (not
 * configured on this machine), rather than treating that as an error. A
 * scan failure on an existing dir is logged and degrades to `null` too — a
 * local-file read problem must never take down the whole Hoy dashboard.
 */
async function scanOrNull<T extends AnyUsageScan>(
  configDir: string,
  scan: () => Promise<T>,
  logger: Logger
): Promise<T | null> {
  if (!configDir || !existsSync(configDir)) return null;
  try {
    return await scan();
  } catch (error) {
    logger.warn('cockpit: usage scan failed', { configDir, error });
    return null;
  }
}
