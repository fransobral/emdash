import { describe, expect, it, vi } from 'vitest';
import type { ProviderAccount } from '@core/services/provider-accounts/api/provider-account-store';
import { resolveClaudeOauthUsage } from './claude-oauth-usage';

function account(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    providerId: 'claude',
    accountId: 'default',
    credentialRef: 'provider-credential:claude:default',
    isDefault: true,
    meta: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('resolveClaudeOauthUsage', () => {
  it('skips an account that did not opt in, never reading its token', async () => {
    const readToken = vi.fn();
    const clientFor = vi.fn();
    const result = await resolveClaudeOauthUsage(
      [account({ meta: { version: '1', configDirPath: '/x', oauthUsageEnabled: false } })],
      0,
      { readToken, clientFor }
    );

    expect(result.size).toBe(0);
    expect(readToken).not.toHaveBeenCalled();
    expect(clientFor).not.toHaveBeenCalled();
  });

  it('skips an opted-in account with no configDirPath', async () => {
    const readToken = vi.fn();
    const result = await resolveClaudeOauthUsage(
      [account({ meta: { version: '1', oauthUsageEnabled: true } })],
      0,
      { readToken, clientFor: vi.fn() }
    );

    expect(result.size).toBe(0);
    expect(readToken).not.toHaveBeenCalled();
  });

  it('skips an opted-in account whose token cannot be read', async () => {
    const readToken = vi.fn().mockResolvedValue(null);
    const getUsage = vi.fn();
    const result = await resolveClaudeOauthUsage(
      [account({ meta: { version: '1', configDirPath: '/x', oauthUsageEnabled: true } })],
      0,
      { readToken, clientFor: () => ({ getUsage }) }
    );

    expect(result.size).toBe(0);
    expect(getUsage).not.toHaveBeenCalled();
  });

  it('resolves a snapshot for an opted-in account with a valid token', async () => {
    const readToken = vi.fn().mockResolvedValue('tok-123');
    const snapshot = { fiveHour: null, weekly: null, fetchedAt: 0, stale: false };
    const getUsage = vi.fn().mockResolvedValue(snapshot);
    const result = await resolveClaudeOauthUsage(
      [account({ meta: { version: '1', configDirPath: '/x', oauthUsageEnabled: true } })],
      0,
      { readToken, clientFor: () => ({ getUsage }) }
    );

    expect(readToken).toHaveBeenCalledWith('/x');
    expect(getUsage).toHaveBeenCalledWith('tok-123', 0);
    expect(result.get('default')).toEqual(snapshot);
  });

  it('omits an account whose client returns null', async () => {
    const readToken = vi.fn().mockResolvedValue('tok-123');
    const getUsage = vi.fn().mockResolvedValue(null);
    const result = await resolveClaudeOauthUsage(
      [account({ meta: { version: '1', configDirPath: '/x', oauthUsageEnabled: true } })],
      0,
      { readToken, clientFor: () => ({ getUsage }) }
    );

    expect(result.size).toBe(0);
  });

  it('resolves multiple opted-in accounts independently', async () => {
    const readToken = vi.fn().mockResolvedValue('tok');
    const snapshotA = { fiveHour: null, weekly: null, fetchedAt: 0, stale: false };
    const snapshotB = { fiveHour: null, weekly: null, fetchedAt: 0, stale: true };
    const clientFor = vi.fn((accountId: string) => ({
      getUsage: async () => (accountId === 'a' ? snapshotA : snapshotB),
    }));
    const result = await resolveClaudeOauthUsage(
      [
        account({
          accountId: 'a',
          meta: { version: '1', configDirPath: '/a', oauthUsageEnabled: true },
        }),
        account({
          accountId: 'b',
          meta: { version: '1', configDirPath: '/b', oauthUsageEnabled: true },
        }),
      ],
      0,
      { readToken, clientFor }
    );

    expect(result.get('a')).toEqual(snapshotA);
    expect(result.get('b')).toEqual(snapshotB);
  });
});
