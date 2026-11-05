import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ClaudeUsageScan, CodexUsageScan } from '@emdash/core/services/usage/node';
import { ClaudeUsageReader, CodexUsageReader } from '@emdash/core/services/usage/node';
import { err, ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { createController, type Controller } from '@emdash/wire/rpc';
import type {
  ProviderAccount,
  ProviderAccountStore,
} from '@core/services/provider-accounts/api/provider-account-store';
import { cockpitContract, type UsageProviderId } from '../api/contract';
import { toLinkedAccount } from './account-linking';
import { ensureSeededAccounts } from './account-seeding';
import { resolveClaudeOauthUsage } from './claude-oauth-usage';
import { CodexAccountUsageClient } from './codex-account-usage';
import { buildUsageSnapshot, startOfLocalDay, type UsageAccountScan } from './usage-snapshot';

type AnyUsageScan = ClaudeUsageScan | CodexUsageScan;
type AnyUsageReader = { scan(sinceMs: number): Promise<AnyUsageScan> };

export function createCockpitWireController(
  logger: Logger,
  accountStore: ProviderAccountStore,
  codexUsageClient: Pick<CodexAccountUsageClient, 'getUsage'> = new CodexAccountUsageClient()
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
    accounts: readonly ProviderAccount[],
    since: number
  ): Promise<UsageAccountScan<TScan>[]> {
    return Promise.all(
      accounts.map(async (account): Promise<UsageAccountScan<TScan>> => {
        const configDirPath = account.meta?.configDirPath ?? '';
        const label = toLinkedAccount(account).label;
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
      const [claudeAccounts, codexAccounts] = await Promise.all([
        accountStore.listAccounts('claude'),
        accountStore.listAccounts('codex'),
      ]);
      const [claude, codex, claudeOauthUsage, codexLive] = await Promise.all([
        scanAccounts<ClaudeUsageScan>('claude', claudeAccounts, since),
        scanAccounts<CodexUsageScan>('codex', codexAccounts, since),
        resolveClaudeOauthUsage(claudeAccounts, now),
        Promise.all(
          codexAccounts.map(async (account) => {
            const home = account.meta?.configDirPath;
            return home && existsSync(path.join(home, 'auth.json'))
              ? codexUsageClient.getUsage(home, now)
              : null;
          })
        ),
      ]);
      // Symlinked history cannot be attributed to either login. Show it once,
      // explicitly as shared local usage, and never use it as per-account limits.
      const roots = await Promise.all(
        codexAccounts.map(async (account) => {
          try {
            return await realpath(path.join(account.meta?.configDirPath ?? '', 'sessions'));
          } catch {
            return null;
          }
        })
      );
      const shared = roots.map(
        (root) => root !== null && roots.filter((candidate) => candidate === root).length > 1
      );
      const scans = codex.map((account, index) =>
        shared[index] && roots.indexOf(roots[index]) !== index
          ? { ...account, scan: account.scan ? { sessions: [], latestRateLimits: null } : null }
          : account
      );
      const snapshot = buildUsageSnapshot({ claude, codex: scans, claudeOauthUsage, now });
      for (const provider of snapshot.providers) {
        const stored = provider.providerId === 'claude' ? claudeAccounts : codexAccounts;
        for (const [index, account] of provider.accounts.entries()) {
          account.rateLimits = { ...account.rateLimits };
          const identity = toLinkedAccount(stored[index]);
          account.email = identity.email;
          account.plan = identity.plan;
          if (provider.providerId === 'codex') {
            const live = codexLive[index];
            if (live) {
              account.email = live.email ?? account.email;
              account.plan = live.plan ?? account.plan;
              account.label = account.email ?? account.label;
              account.rateLimits = live.rateLimits;
              account.usageAllowed = live.usageAllowed;
              account.blockedReason = live.blockedReason;
              if (!live.rateLimits.fiveHour && live.rateLimits.weekly)
                account.rateLimits.note =
                  'El proveedor no informa una ventana de 5h para esta cuenta.';
            } else if (shared[index]) {
              account.rateLimits = {
                source: 'unavailable',
                fiveHour: null,
                weekly: null,
                stale: false,
                note: 'No se pudieron consultar los límites de esta cuenta. El historial compartido no identifica su cuota.',
              };
            } else {
              account.rateLimits.stale = true;
              account.rateLimits.note =
                'Último límite registrado localmente; no pudimos consultar el estado actual.';
            }
            if (shared[index])
              account.usageNote =
                roots.indexOf(roots[index]) === index
                  ? 'Historial local compartido entre cuentas: estos tokens no se pueden atribuir a este mail. Se muestran una sola vez.'
                  : 'Comparte el historial local con la otra cuenta. Sus tokens se muestran allí una sola vez; los límites sí se consultan por separado.';
          } else if (!claudeOauthUsage.has(account.accountId)) {
            account.rateLimits.note = stored[index].meta?.oauthUsageEnabled
              ? 'No pudimos consultar Claude. Revisá el inicio de sesión y volvé a actualizar.'
              : 'La consulta de límites de Claude está desactivada. Activala en Cuentas vinculadas.';
          } else {
            account.rateLimits.origin = 'live';
            account.rateLimits.observedAt = claudeOauthUsage.get(account.accountId)?.fetchedAt;
          }
        }
      }
      return snapshot;
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

    setUsageOauthEnabled: async (input) => {
      if (input.providerId !== 'claude') {
        return err({ message: 'Esta opción solo está disponible para cuentas de Claude.' });
      }
      try {
        const existing = await accountStore.getAccount(input.providerId, input.accountId);
        if (!existing) return err({ message: 'No encontramos esa cuenta.' });
        const { version: _version, ...meta } = existing.meta ?? {};
        const result = await accountStore.upsertAccount({
          providerId: input.providerId,
          accountId: input.accountId,
          meta: { ...meta, oauthUsageEnabled: input.enabled },
        });
        return ok(toLinkedAccount(result.account));
      } catch (error) {
        logger.error('cockpit: failed to update usage OAuth setting', { error });
        return err({ message: 'No pudimos actualizar la configuración.' });
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
