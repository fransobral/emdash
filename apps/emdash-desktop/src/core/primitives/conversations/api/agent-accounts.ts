/**
 * Portable types for the agent-account picker surfaced in the create-conversation modal.
 * Accounts themselves are owned by the provider-accounts store (see
 * `@core/services/provider-accounts/api/provider-account-store`); these types describe the
 * conversations-facing projection of that store, scoped to the providers that support
 * CLI-config-directory accounts (Claude, Codex).
 */

/** Provider ids that support picking a CLI-config-directory account. */
export type AgentAccountProviderId = 'codex' | 'claude';

export function isAgentAccountProviderId(value: string): value is AgentAccountProviderId {
  return value === 'codex' || value === 'claude';
}

/** One selectable account for a given provider. */
export type AgentAccountInfo = {
  id: string;
  label: string;
  /** The CLI config directory this account points at, or null when unresolved. */
  home: string | null;
  loggedIn: boolean;
};

export type AgentAccountsByProvider = Record<AgentAccountProviderId, AgentAccountInfo[]>;
