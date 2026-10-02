import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type {
  ProviderAccount,
  ProviderAccountUpsert,
} from '@core/services/provider-accounts/api/provider-account-store';
import { detectSeedAccounts, ensureSeededAccounts, type SeedAccountSpec } from './account-seeding';

describe('detectSeedAccounts', () => {
  it('defaults to ~/.claude and ~/.codex when no env overrides are set', () => {
    const specs = detectSeedAccounts({});
    expect(specs).toEqual([
      expect.objectContaining({ providerId: 'claude', accountId: 'default' }),
      expect.objectContaining({ providerId: 'codex', accountId: 'default' }),
    ]);
    expect(specs[0].configDirPath).toMatch(/\.claude$/);
    expect(specs[1].configDirPath).toMatch(/\.codex$/);
  });

  it('respects CLAUDE_CONFIG_DIR and CODEX_HOME overrides', () => {
    const specs = detectSeedAccounts({
      CLAUDE_CONFIG_DIR: '/custom/claude',
      CODEX_HOME: '/custom/codex',
    });
    expect(specs[0].configDirPath).toBe('/custom/claude');
    expect(specs[1].configDirPath).toBe('/custom/codex');
  });

  it('adds a fallback Codex account only when EMDASH_CODEX_FALLBACK_HOME is set', () => {
    expect(detectSeedAccounts({})).toHaveLength(2);
    const specs = detectSeedAccounts({ EMDASH_CODEX_FALLBACK_HOME: '/custom/codex-fallback' });
    expect(specs).toHaveLength(3);
    expect(specs[2]).toEqual(
      expect.objectContaining({
        providerId: 'codex',
        accountId: 'fallback',
        configDirPath: '/custom/codex-fallback',
      })
    );
  });
});

function fakeStore(existing: readonly ProviderAccount[] = []) {
  const upsertAccount = vi.fn(async (input: ProviderAccountUpsert) => ({
    account: {
      providerId: input.providerId,
      accountId: input.accountId,
      credentialRef: `provider-credential:${input.providerId}:${input.accountId}`,
      isDefault: false,
      meta: input.meta ? { version: '1' as const, ...input.meta } : null,
      createdAt: 0,
      updatedAt: 0,
    },
    status: 'created' as const,
  }));
  const getAccount = vi.fn(
    async (providerId: string, accountId?: string) =>
      existing.find((a) => a.providerId === providerId && a.accountId === accountId) ?? null
  );
  return { getAccount, upsertAccount };
}

describe('ensureSeededAccounts', () => {
  const spec: SeedAccountSpec = {
    providerId: 'claude',
    accountId: 'default',
    label: 'Claude',
    configDirPath: '/home/user/.claude',
  };

  it('skips seeding when the config dir does not exist on this machine', async () => {
    const store = fakeStore();
    await ensureSeededAccounts(store, noopLogger, [spec], () => false);
    expect(store.upsertAccount).not.toHaveBeenCalled();
  });

  it('seeds the account when the dir exists and no row has ever been created', async () => {
    const store = fakeStore();
    await ensureSeededAccounts(store, noopLogger, [spec], () => true);
    expect(store.upsertAccount).toHaveBeenCalledWith({
      providerId: 'claude',
      accountId: 'default',
      meta: { label: 'Claude', configDirPath: '/home/user/.claude', credentialSource: 'cli' },
    });
  });

  it('never re-seeds an account the user already removed (or already linked)', async () => {
    const store = fakeStore([
      {
        providerId: 'claude',
        accountId: 'default',
        credentialRef: 'x',
        isDefault: true,
        meta: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    await ensureSeededAccounts(store, noopLogger, [spec], () => true);
    expect(store.upsertAccount).not.toHaveBeenCalled();
  });

  it('logs and continues when a store write fails, instead of throwing', async () => {
    const store = fakeStore();
    store.upsertAccount.mockRejectedValueOnce(new Error('db locked'));
    const logger = { ...noopLogger, warn: vi.fn() };
    await expect(ensureSeededAccounts(store, logger, [spec], () => true)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
