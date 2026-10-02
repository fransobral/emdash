import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProviderAccount } from '@core/services/provider-accounts/api/provider-account-store';
import type { UsageLinkedAccount, UsageProviderId } from '../api/contract';

const CREDENTIAL_FILENAMES: Record<UsageProviderId, string> = {
  claude: '.credentials.json',
  codex: 'auth.json',
};

/**
 * Whether a provider's own CLI credential file has shown up in a config
 * directory. Checked fresh on every call — this is a single `existsSync`,
 * never cached, so "check again" is just re-reading the account list.
 */
export function hasLinkedCredential(
  providerId: UsageProviderId,
  configDirPath: string,
  fsExists: (candidate: string) => boolean = existsSync
): boolean {
  if (!configDirPath) return false;
  return fsExists(path.join(configDirPath, CREDENTIAL_FILENAMES[providerId]));
}

/** Maps a stored provider account row to the Hoy view's account-linking DTO. */
export function toLinkedAccount(
  account: ProviderAccount,
  fsExists: (candidate: string) => boolean = existsSync
): UsageLinkedAccount {
  const providerId = account.providerId as UsageProviderId;
  const configDirPath = account.meta?.configDirPath ?? '';
  return {
    providerId,
    accountId: account.accountId,
    label: account.meta?.label ?? account.meta?.fallbackDisplayName ?? account.accountId,
    configDirPath,
    isDefault: account.isDefault,
    credentialStatus: hasLinkedCredential(providerId, configDirPath, fsExists)
      ? 'linked'
      : 'missing',
  };
}
