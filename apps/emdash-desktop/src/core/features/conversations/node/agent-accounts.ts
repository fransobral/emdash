import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  isAgentAccountProviderId,
  type AgentAccountInfo,
  type AgentAccountProviderId,
  type AgentAccountsByProvider,
} from '@core/primitives/conversations/api/agent-accounts';
import type { ProviderAccountStore } from '@core/services/provider-accounts/api/provider-account-store';

const PROVIDER_IDS: AgentAccountProviderId[] = ['codex', 'claude'];

const PROVIDER_LABELS: Record<AgentAccountProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
};

/** Same credential filenames account-linking.ts checks for the cockpit usage view. */
const CREDENTIAL_FILENAMES: Record<AgentAccountProviderId, string> = {
  claude: '.credentials.json',
  codex: 'auth.json',
};

function hasLinkedCredential(
  providerId: AgentAccountProviderId,
  configDirPath: string | null,
  fsExists: (candidate: string) => boolean
): boolean {
  if (!configDirPath) return false;
  return fsExists(path.join(configDirPath, CREDENTIAL_FILENAMES[providerId]));
}

/**
 * Lists the Claude/Codex accounts available for the create-conversation account picker,
 * sourced from the shared `ProviderAccountStore` (the same registry cockpit's multi-account
 * linking reads and seeds at boot).
 */
export async function listAgentAccounts(
  store: ProviderAccountStore,
  fsExists: (candidate: string) => boolean = existsSync
): Promise<AgentAccountsByProvider> {
  const result = {} as AgentAccountsByProvider;
  for (const providerId of PROVIDER_IDS) {
    const accounts = await store.listAccounts(providerId);
    result[providerId] = accounts.map((account, index): AgentAccountInfo => {
      const configDirPath = account.meta?.configDirPath ?? null;
      return {
        id: account.accountId,
        label:
          account.meta?.label ??
          account.meta?.fallbackDisplayName ??
          `${PROVIDER_LABELS[providerId]} ${index + 1}`,
        home: configDirPath,
        loggedIn: hasLinkedCredential(providerId, configDirPath, fsExists),
      };
    });
  }
  return result;
}

/** Env var each provider's CLI reads to locate its config/credentials directory. */
const CONFIG_DIR_ENV_VAR: Record<AgentAccountProviderId, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};

/**
 * Resolves the env override for a conversation's selected agent account. Returns an empty
 * object when no account is selected, the provider doesn't support accounts, the account no
 * longer exists, or the account is the provider's default — the default account needs no
 * override since it's already what the CLI uses without one.
 */
export async function resolveAgentAccountEnv(
  store: ProviderAccountStore,
  providerId: string,
  accountId: string | undefined
): Promise<Record<string, string>> {
  if (!accountId || !isAgentAccountProviderId(providerId)) return {};
  const account = await store.getAccount(providerId, accountId);
  if (!account || account.isDefault) return {};
  const configDirPath = account.meta?.configDirPath;
  if (!configDirPath) return {};
  return { [CONFIG_DIR_ENV_VAR[providerId]]: configDirPath };
}
