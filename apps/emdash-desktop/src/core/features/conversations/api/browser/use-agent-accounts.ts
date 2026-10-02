import { useQuery } from '@tanstack/react-query';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import type { AgentAccountsByProvider } from '@core/primitives/conversations/api';

export const AGENT_ACCOUNTS_QUERY_KEY = ['conversations', 'agent-accounts'] as const;

/** Lists the Claude/Codex accounts available for the create-conversation account picker. */
export function useAgentAccounts() {
  return useQuery<AgentAccountsByProvider>({
    queryKey: AGENT_ACCOUNTS_QUERY_KEY,
    queryFn: async () => (await getConversationsClient()).listAgentAccounts(),
    staleTime: 60 * 1000,
  });
}
