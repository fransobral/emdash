import { describe, expect, it } from 'vitest';
import type {
  ProviderAccount,
  ProviderAccountStore,
} from '@core/services/provider-accounts/api/provider-account-store';
import { listAgentAccounts, resolveAgentAccountEnv } from './agent-accounts';

describe('listAgentAccounts', () => {
  it('maps stored accounts to labeled, credential-checked picker entries', async () => {
    const store = fakeStore({
      claude: [
        account('claude', 'default', { isDefault: true, label: 'Claude', home: '/home/.claude' }),
      ],
      codex: [
        account('codex', 'default', { isDefault: true, label: 'Codex', home: '/home/.codex' }),
        account('codex', 'fallback', { label: 'Codex (respaldo)', home: '/home/.codex-fallback' }),
      ],
    });

    const result = await listAgentAccounts(store, (candidate) =>
      candidate.includes('.codex/auth.json')
    );

    expect(result.claude).toEqual([
      { id: 'default', label: 'Claude', home: '/home/.claude', loggedIn: false },
    ]);
    expect(result.codex).toEqual([
      { id: 'default', label: 'Codex', home: '/home/.codex', loggedIn: true },
      { id: 'fallback', label: 'Codex (respaldo)', home: '/home/.codex-fallback', loggedIn: false },
    ]);
  });

  it('falls back to "<Provider> N" labels when no stored label exists', async () => {
    const store = fakeStore({
      claude: [],
      codex: [account('codex', 'acc-2', { home: '/home/.codex-2' })],
    });

    const result = await listAgentAccounts(store, () => false);

    expect(result.codex[0]).toMatchObject({ id: 'acc-2', label: 'Codex 1' });
  });
});

describe('resolveAgentAccountEnv', () => {
  it('returns an empty object when no account id is given', async () => {
    const store = fakeStore({ claude: [], codex: [] });
    expect(await resolveAgentAccountEnv(store, 'codex', undefined)).toEqual({});
  });

  it('returns an empty object for an unsupported provider', async () => {
    const store = fakeStore({ claude: [], codex: [] });
    expect(await resolveAgentAccountEnv(store, 'github', 'some-account')).toEqual({});
  });

  it('returns an empty object for the default account', async () => {
    const store = fakeStore({
      codex: [account('codex', 'default', { isDefault: true, home: '/home/.codex' })],
      claude: [],
    });
    expect(await resolveAgentAccountEnv(store, 'codex', 'default')).toEqual({});
  });

  it('maps a non-default codex account to CODEX_HOME', async () => {
    const store = fakeStore({
      codex: [account('codex', 'fallback', { home: '/home/.codex-fallback' })],
      claude: [],
    });
    expect(await resolveAgentAccountEnv(store, 'codex', 'fallback')).toEqual({
      CODEX_HOME: '/home/.codex-fallback',
    });
  });

  it('maps a non-default claude account to CLAUDE_CONFIG_DIR', async () => {
    const store = fakeStore({
      claude: [account('claude', 'work', { home: '/home/.claude-work' })],
      codex: [],
    });
    expect(await resolveAgentAccountEnv(store, 'claude', 'work')).toEqual({
      CLAUDE_CONFIG_DIR: '/home/.claude-work',
    });
  });

  it('returns an empty object when the account no longer exists', async () => {
    const store = fakeStore({ claude: [], codex: [] });
    expect(await resolveAgentAccountEnv(store, 'codex', 'gone')).toEqual({});
  });
});

function account(
  providerId: string,
  accountId: string,
  overrides: { isDefault?: boolean; label?: string; home?: string } = {}
): ProviderAccount {
  return {
    providerId,
    accountId,
    credentialRef: `${providerId}:${accountId}`,
    isDefault: overrides.isDefault ?? false,
    meta: {
      version: '1',
      label: overrides.label,
      configDirPath: overrides.home,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeStore(byProvider: Record<string, ProviderAccount[]>): ProviderAccountStore {
  return {
    listAccounts: async (providerId) => byProvider[providerId] ?? [],
    getAccount: async (providerId, accountId) =>
      (byProvider[providerId] ?? []).find((a) => a.accountId === accountId) ?? null,
    upsertAccount: async () => {
      throw new Error('not used in this test');
    },
    getDefaultAccountId: async () => null,
    setDefaultAccount: async () => null,
    resolveSecret: async () => null,
    removeAccount: async () => null,
    isConfigured: async () => true,
  };
}
