import type { ClaudeOAuthUsageSnapshot } from '@emdash/core/services/usage/node';
import {
  ClaudeOAuthUsageClient,
  readClaudeOAuthAccessToken,
} from '@emdash/core/services/usage/node';
import type { ProviderAccount } from '@core/services/provider-accounts/api/provider-account-store';

export type ClaudeOauthUsageDeps = Readonly<{
  readToken: (configDirPath: string) => Promise<string | null>;
  clientFor: (accountId: string) => Pick<ClaudeOAuthUsageClient, 'getUsage'>;
}>;

const defaultClients = new Map<string, ClaudeOAuthUsageClient>();

function defaultClientFor(accountId: string): ClaudeOAuthUsageClient {
  let client = defaultClients.get(accountId);
  if (!client) {
    client = new ClaudeOAuthUsageClient();
    defaultClients.set(accountId, client);
  }
  return client;
}

export const defaultClaudeOauthUsageDeps: ClaudeOauthUsageDeps = {
  readToken: readClaudeOAuthAccessToken,
  clientFor: defaultClientFor,
};

/**
 * Resolves the opt-in Anthropic OAuth usage snapshot for every Claude
 * account that has turned it on (`meta.oauthUsageEnabled`), keyed by
 * accountId. Every other account is skipped before its credential file is
 * ever read — this function never reads a token for an account that did
 * not opt in. Never throws: a missing token, a missing config dir, or a
 * failed fetch all degrade to no entry in the returned map, which the
 * caller treats the same as "no disponible".
 */
export async function resolveClaudeOauthUsage(
  accounts: readonly ProviderAccount[],
  now: number,
  deps: ClaudeOauthUsageDeps = defaultClaudeOauthUsageDeps
): Promise<Map<string, ClaudeOAuthUsageSnapshot>> {
  const result = new Map<string, ClaudeOAuthUsageSnapshot>();
  await Promise.all(
    accounts.map(async (account) => {
      if (!account.meta?.oauthUsageEnabled) return;
      const configDirPath = account.meta?.configDirPath ?? '';
      if (!configDirPath) return;
      const token = await deps.readToken(configDirPath);
      if (!token) return;
      const snapshot = await deps.clientFor(account.accountId).getUsage(token, now);
      if (snapshot) result.set(account.accountId, snapshot);
    })
  );
  return result;
}
