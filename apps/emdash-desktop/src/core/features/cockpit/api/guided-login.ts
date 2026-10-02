import type { UsageProviderId } from './contract';

const GUIDED_LOGIN_ENV_VAR: Record<UsageProviderId, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};

const GUIDED_LOGIN_COMMAND: Record<UsageProviderId, string> = {
  claude: 'claude',
  codex: 'codex login',
};

/**
 * The command a user runs in their own terminal to log in under a given
 * config directory. Emdash never performs the OAuth/login flow itself —
 * this only tells the user what to run; they run it (in a real terminal,
 * or emdash's in-app terminal) and emdash later notices the credential
 * file that command produces.
 */
export function guidedLoginCommand(providerId: UsageProviderId, configDirPath: string): string {
  return `${GUIDED_LOGIN_ENV_VAR[providerId]}="${configDirPath}" ${GUIDED_LOGIN_COMMAND[providerId]}`;
}
