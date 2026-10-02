import { describe, expect, it } from 'vitest';
import type { ProviderAccount } from '@core/services/provider-accounts/api/provider-account-store';
import { hasLinkedCredential, toLinkedAccount } from './account-linking';

describe('hasLinkedCredential', () => {
  it('checks for .credentials.json under the Claude config dir', () => {
    const exists = (candidate: string) => candidate === '/home/user/.claude/.credentials.json';
    expect(hasLinkedCredential('claude', '/home/user/.claude', exists)).toBe(true);
    expect(hasLinkedCredential('claude', '/home/user/.claude-other', exists)).toBe(false);
  });

  it('checks for auth.json under the Codex home', () => {
    const exists = (candidate: string) => candidate === '/home/user/.codex/auth.json';
    expect(hasLinkedCredential('codex', '/home/user/.codex', exists)).toBe(true);
  });

  it('is false for an empty config dir path', () => {
    expect(hasLinkedCredential('claude', '', () => true)).toBe(false);
  });
});

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

describe('toLinkedAccount', () => {
  it('maps label, configDirPath and isDefault from meta', () => {
    const linked = toLinkedAccount(
      account({ meta: { version: '1', label: 'Mi cuenta', configDirPath: '/x' } }),
      () => true
    );
    expect(linked).toEqual({
      providerId: 'claude',
      accountId: 'default',
      label: 'Mi cuenta',
      configDirPath: '/x',
      isDefault: true,
      credentialStatus: 'linked',
    });
  });

  it('falls back to fallbackDisplayName, then the raw accountId, for the label', () => {
    expect(
      toLinkedAccount(
        account({ meta: { version: '1', fallbackDisplayName: 'Cuenta 2' } }),
        () => false
      ).label
    ).toBe('Cuenta 2');
    expect(toLinkedAccount(account({ meta: null }), () => false).label).toBe('default');
  });

  it('reports a missing credential when the file is not present yet', () => {
    const linked = toLinkedAccount(
      account({ meta: { version: '1', configDirPath: '/x' } }),
      () => false
    );
    expect(linked.credentialStatus).toBe('missing');
  });
});
