import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { ApiClientError } from './api';
import type { CurrentUser } from '@bookleaf/contracts';

export const sessionKey = ['session'] as const;
export const sessionExpiredKey = ['session', 'expired'] as const;
export async function replaceSession(client: QueryClient, user: CurrentUser | null) {
  await client.cancelQueries();
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  client.setQueryData(sessionExpiredKey, false);
  client.setQueryData(sessionKey, user);
}
export function createQueryClient() {
  const expired = (error: unknown) => {
    if (error instanceof ApiClientError && error.status === 401) {
      void client.cancelQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      if (client.getQueryData(sessionKey)) client.setQueryData(sessionExpiredKey, true);
      client.setQueryData(sessionKey, null);
    }
  };
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: expired }),
    mutationCache: new MutationCache({ onError: expired }),
    defaultOptions: {
      queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  return client;
}
// Poll slowly after failure. Normal five-second updates resume after success.
export function pollDelay(error: unknown, failures: number): number | false {
  if (error instanceof ApiClientError && [400, 401, 403, 404].includes(error.status)) return false;
  return error ? Math.min(60_000, 30_000 * Math.max(1, failures)) : 5_000;
}
export const polling = {
  refetchInterval: (query: { state: { error: Error | null; fetchFailureCount: number } }) =>
    pollDelay(query.state.error, query.state.fetchFailureCount),
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
};
