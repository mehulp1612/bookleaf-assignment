import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, type CurrentUser } from '@bookleaf/contracts';
import { request, ApiClientError } from '../../shared/api';
import { sessionKey, sessionExpiredKey, replaceSession } from '../../shared/queries';

export interface TicketDraft {
  ownerId: string;
  bookId: string;
  subject: string;
  description: string;
}
function useSessionState() {
  const client = useQueryClient();
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const expired = useQuery({
    queryKey: sessionExpiredKey,
    queryFn: () => false,
    initialData: false,
    enabled: false,
  });
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }) => {
      try {
        return (await request('/api/v1/auth/me', endpoints.me.response, { signal })).data;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          if (client.getQueryData(sessionKey)) client.setQueryData(sessionExpiredKey, true);
          void client.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
          client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
          return null;
        }
        throw error;
      }
    },
    staleTime: 0,
  });
  const acceptLogin = async (user: CurrentUser) => {
    await replaceSession(client, user);
    setDraft((old) => (old?.ownerId === user.id ? old : null));
  };
  const logout = async () => {
    try {
      await request('/api/v1/auth/logout', endpoints.logout.response, { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiClientError && error.status === 401)) throw error;
    }
    await replaceSession(client, null);
    setDraft(null);
  };
  return { session, expired: expired.data, acceptLogin, logout, draft, setDraft };
}
const SessionContext = createContext<ReturnType<typeof useSessionState> | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSessionState();
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session provider missing');
  return value;
}
