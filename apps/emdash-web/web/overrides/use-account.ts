import { invalidateProviderAccountState } from '@core/features/integrations/api/browser/use-provider-accounts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccountClient } from '@core/features/account/api/browser/client';

export const ACCOUNT_SESSION_KEY = ['account:session'] as const;
const ACCOUNT_HEALTH_KEY = ['account:health'] as const;

function openOAuthWindow(): Window | null {
  return window.open(
    '/auth/oauth/launch',
    'emdash-oauth',
    'popup=yes,width=560,height=760,resizable=yes,scrollbars=yes'
  );
}

export function useAccountSession() {
  return useQuery({
    queryKey: ACCOUNT_SESSION_KEY,
    queryFn: async () => (await getAccountClient()).getSession(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useAccountSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (provider: string | undefined) => {
      const popup = openOAuthWindow();
      try {
        return await (await getAccountClient()).signIn({ provider });
      } catch (error) {
        popup?.close();
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
      void invalidateProviderAccountState(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });
}

export function useAccountLinkProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (provider: string | undefined) => {
      const popup = openOAuthWindow();
      try {
        return await (await getAccountClient()).linkProviderAccount({ provider });
      } catch (error) {
        popup?.close();
        throw error;
      }
    },
    onSuccess: () => void invalidateProviderAccountState(queryClient),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    },
  });
}

export function useAccountSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await getAccountClient()).signOut(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    },
  });
}

export function useAccountHealth() {
  return useQuery({
    queryKey: ACCOUNT_HEALTH_KEY,
    queryFn: async () => (await getAccountClient()).checkHealth(),
    staleTime: 60_000,
  });
}

export function useFetchAccountHealth() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: ACCOUNT_HEALTH_KEY,
      queryFn: async () => (await getAccountClient()).checkHealth(),
      staleTime: 0,
    });
}
