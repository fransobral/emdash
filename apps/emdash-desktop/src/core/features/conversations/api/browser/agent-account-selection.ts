import type { AgentAccountInfo } from '@core/primitives/conversations/api';

/**
 * Resolves which account should be pre-selected in the picker: the saved preference when its
 * account still exists for this provider, otherwise the provider's first (default) account.
 */
export function resolveSelectedAccountId(
  accounts: readonly AgentAccountInfo[],
  savedAccountId: string | undefined
): string | undefined {
  if (savedAccountId && accounts.some((account) => account.id === savedAccountId)) {
    return savedAccountId;
  }
  return accounts[0]?.id;
}

/** A short warning to show next to an account that has no linked CLI credential yet. */
export function accountNotLoggedInHint(account: AgentAccountInfo | undefined): string | null {
  if (!account || account.loggedIn) return null;
  return `Not signed in${account.home ? ` (${account.home})` : ''}`;
}
