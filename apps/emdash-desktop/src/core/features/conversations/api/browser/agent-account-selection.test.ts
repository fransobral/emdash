import { describe, expect, it } from 'vitest';
import type { AgentAccountInfo } from '@core/primitives/conversations/api';
import { accountNotLoggedInHint, resolveSelectedAccountId } from './agent-account-selection';

const accounts: AgentAccountInfo[] = [
  { id: 'default', label: 'Codex', home: '/home/.codex', loggedIn: true },
  { id: 'fallback', label: 'Codex (respaldo)', home: '/home/.codex-fallback', loggedIn: false },
];

describe('resolveSelectedAccountId', () => {
  it('keeps the saved account when it still exists', () => {
    expect(resolveSelectedAccountId(accounts, 'fallback')).toBe('fallback');
  });

  it('falls back to the first account when the saved one is gone', () => {
    expect(resolveSelectedAccountId(accounts, 'removed')).toBe('default');
  });

  it('falls back to the first account when nothing was saved', () => {
    expect(resolveSelectedAccountId(accounts, undefined)).toBe('default');
  });

  it('returns undefined when the provider has no accounts', () => {
    expect(resolveSelectedAccountId([], undefined)).toBeUndefined();
  });
});

describe('accountNotLoggedInHint', () => {
  it('returns null when the account is logged in', () => {
    expect(accountNotLoggedInHint(accounts[0])).toBeNull();
  });

  it('returns null when no account is given', () => {
    expect(accountNotLoggedInHint(undefined)).toBeNull();
  });

  it('returns a hint naming the config dir when logged out', () => {
    expect(accountNotLoggedInHint(accounts[1])).toBe('Not signed in (/home/.codex-fallback)');
  });
});
