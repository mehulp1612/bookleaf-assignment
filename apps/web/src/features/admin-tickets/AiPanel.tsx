import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import { ErrorNotice, Loading } from '../../shared/ui';
import { pollDelay } from '../../shared/queries';
import { httpDraftApi, canRequestDraft, draftPending, type DraftApi, type DraftLookup } from './ai';

export function AiPanel({
  ticketId,
  ticketRevision,
  hasText,
  locked,
  onUse,
  api = httpDraftApi,
}: {
  ticketId: string;
  ticketRevision: number;
  hasText: boolean;
  locked: boolean;
  onUse: (text: string) => void;
  api?: DraftApi;
}) {
  const { session } = useSession();
  const client = useQueryClient();
  const key = ['admin-draft', session.data?.id, ticketId, ticketRevision];
  const [replacement, setReplacement] = useState<{
    id: string;
    text: string;
    revision: number;
  } | null>(null);
  const latest = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.latest(ticketId, signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.error
        ? pollDelay(query.state.error, query.state.fetchFailureCount)
        : query.state.data?.available && draftPending(query.state.data.draft)
          ? 5000
          : false,
  });
  const generate = useMutation({
    mutationFn: async (regenerate: boolean) => {
      if (!canRequestDraft(latest.data, regenerate))
        throw new Error('Draft state changed. Refresh before requesting.');
      await client.cancelQueries({ queryKey: key });
      return api.generate(ticketId, regenerate);
    },
    onSuccess: (draft) => {
      client.setQueryData(key, (): DraftLookup => ({ available: true, draft }));
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const draft = latest.data?.available ? latest.data.draft : undefined;
  return (
    <section className="panel ai-panel" aria-labelledby="ai-heading">
      <h2 id="ai-heading">AI draft assistance</h2>
      <p className="small muted">
        Suggestions are for review only. Nothing is sent automatically. Your reply editor is never
        replaced by polling.
      </p>
      {latest.isPending && <Loading>Checking draft availability…</Loading>}
      {latest.error && (
        <ErrorNotice error={latest.error} retry={() => void latest.refetch()} />
      )}{' '}
      {latest.data && !latest.data.available && (
        <div className="notice" role="status">
          <p>AI drafts are unavailable on this server. You can write and send a reply manually.</p>
          <button
            className="secondary"
            onClick={() => void latest.refetch()}
            disabled={latest.isFetching}
          >
            Check availability
          </button>
        </div>
      )}
      {draft && (
        <>
          <p role="status">
            {draft.state === 'NOT_REQUESTED'
              ? 'No AI draft requested.'
              : draft.state === 'QUEUED'
                ? 'Draft queued. Manual replying remains available.'
                : draft.state === 'RUNNING'
                  ? 'Draft generation in progress…'
                  : draft.state === 'FAILED'
                    ? 'Draft generation failed.'
                    : 'Draft suggestion ready for review.'}
          </p>
          {draft.state !== 'NOT_REQUESTED' && draft.stale && (
            <p className="field-error">
              This draft is stale. Regenerate it for the current conversation.
            </p>
          )}
          {draft.state === 'FAILED' && (
            <p role="alert" className="error-notice">
              {draft.failureReason}
            </p>
          )}
          {draft.state === 'SUCCEEDED' && (
            <>
              <p className="plain-text ai-suggestion">{draft.text}</p>
              <button
                className="secondary"
                disabled={draft.stale || locked}
                onClick={() =>
                  hasText
                    ? setReplacement({ id: draft.id, text: draft.text, revision: ticketRevision })
                    : onUse(draft.text)
                }
              >
                Use draft in reply editor
              </button>
            </>
          )}
          {canRequestDraft(latest.data, false) && (
            <button
              className="secondary"
              disabled={generate.isPending || latest.isFetching}
              onClick={() => generate.mutate(false)}
            >
              Request AI draft
            </button>
          )}
          {canRequestDraft(latest.data, true) && (
            <button
              className="secondary"
              disabled={generate.isPending || latest.isFetching}
              onClick={() => generate.mutate(true)}
            >
              Regenerate AI draft
            </button>
          )}
        </>
      )}
      {generate.isPending && <Loading>Requesting draft…</Loading>}
      {generate.error && (
        <>
          <ErrorNotice error={generate.error} />
          <p className="small">
            Checking the latest state before another request; your reply is unchanged.
          </p>
        </>
      )}
      {replacement !== null && (
        <div className="notice" role="alert">
          <p>
            Replace the unsent public reply with this draft? Regenerating alone never changes your
            text.
          </p>
          <button
            disabled={
              locked ||
              draft?.state !== 'SUCCEEDED' ||
              draft.id !== replacement.id ||
              draft.stale ||
              ticketRevision !== replacement.revision
            }
            onClick={() => {
              onUse(replacement.text);
              setReplacement(null);
            }}
          >
            Replace my reply text
          </button>{' '}
          <button className="secondary" onClick={() => setReplacement(null)}>
            Keep my text
          </button>
        </div>
      )}
    </section>
  );
}
