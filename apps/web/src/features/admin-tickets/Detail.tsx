import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  allowedStatusTransitions,
  categoryLabels,
  categorySchema,
  priorityLabels,
  prioritySchema,
  statusLabels,
  ticketStatusSchema,
  updateTicketRequestSchema,
  createNoteRequestSchema,
  endpoints,
  type AdminTicketDetail,
} from '@bookleaf/contracts';
import { useSession } from '../auth/session';
import { ApiClientError, request } from '../../shared/api';
import { polling } from '../../shared/queries';
import { ErrorNotice, Loading, Status } from '../../shared/ui';
import { calendarDate, money, timestamp } from '../../shared/format';
import { adminApi } from './api';
import {
  editorReducer,
  emptyEditor,
  replyAttempt,
  type ReplyAttempt,
  type TicketChanges,
} from './model';
import { AiPanel } from './AiPanel';

function ambiguous(error: unknown) {
  return (
    !(error instanceof ApiClientError) || error.status >= 500 || error.code === 'INVALID_RESPONSE'
  );
}
function BookContext({ id }: { id: string }) {
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['admin-book', session.data?.id, id],
    queryFn: ({ signal }) =>
      request(`/api/v1/books/${encodeURIComponent(id)}`, endpoints.book.response, { signal }),
  });
  const book = query.data?.data;
  return (
    <section className="panel">
      <h2>Verified book context</h2>
      {query.isPending && <Loading>Loading book details…</Loading>}
      {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}{' '}
      {book && (
        <>
          <h3>{book.title}</h3>
          <span className="badge">{book.status}</span>
          <dl className="book-facts">
            {[
              ['ISBN', book.isbn],
              ['Genre', book.genre],
              ['Publication date', calendarDate(book.publicationDate)],
              ['MRP', money(book.mrpPaise)],
              ['Royalty per copy', money(book.authorRoyaltyPerCopyPaise)],
              ['Copies sold', String(book.totalCopiesSold)],
              ['Earned', money(book.totalRoyaltyEarnedPaise)],
              ['Paid', money(book.royaltyPaidPaise)],
              ['Pending', money(book.royaltyPendingPaise)],
              ['Last payout', calendarDate(book.lastRoyaltyPayoutDate)],
              ['Print partner', book.printPartner ?? 'Not available'],
              ['Platforms', book.availableOn.join(', ') || 'None listed'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">
            Supplied snapshots only. No banking data, payment deadline, or transaction history is
            available.
          </p>
        </>
      )}
    </section>
  );
}
export function Classification({ ticket }: { ticket: AdminTicketDetail }) {
  return (
    <section className="classification-summary">
      <h3>Classification</h3>
      <p>
        {ticket.category ? categoryLabels[ticket.category] : 'Not classified'} ·{' '}
        {priorityLabels[ticket.priority]} priority
      </p>
      <p className="small">
        Category:{' '}
        {ticket.categorySource === 'MANUAL'
          ? 'manual override'
          : ticket.categorySource === 'AI'
            ? 'AI suggestion applied'
            : 'awaiting classification'}
        . Priority:{' '}
        {ticket.prioritySource === 'MANUAL'
          ? 'manual override'
          : ticket.prioritySource === 'AI'
            ? 'AI suggestion applied'
            : 'provisional default'}
        .
      </p>
      <p role="status" className="small muted">
        {ticket.classificationState === 'FAILED'
          ? 'AI classification failed. Set category and priority manually.'
          : ticket.classificationState === 'QUEUED'
            ? 'Classification is queued. Manual handling remains available.'
            : ticket.classificationState === 'RUNNING'
              ? 'AI classification is running.'
              : ticket.classificationState === 'SUCCEEDED'
                ? 'Classification completed. Manual overrides remain in effect.'
                : 'Classification has not been requested.'}
      </p>
    </section>
  );
}
export function AdminTicketContent({
  ticket,
  refresh,
}: {
  ticket: AdminTicketDetail;
  refresh: () => Promise<unknown>;
}) {
  const { session } = useSession();
  const user = session.data!;
  const client = useQueryClient();
  const [changes, setChanges] = useState<TicketChanges>({});
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, emptyEditor);
  const [note, setNote] = useState('');
  const [noteUncertain, setNoteUncertain] = useState(false);
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const replyBusy = useRef(false);
  const noteBusy = useRef(false);
  const updateBusy = useRef(false);
  const dirty = !!editor.body || !!note || Object.keys(changes).length > 0;
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const detailKey = ['admin-ticket', user.id, ticket.id];
  async function reload() {
    await client.invalidateQueries({ queryKey: ['admin-tickets'] });
    await refresh();
  }
  const update = useMutation({
    mutationFn: async () => {
      const input = updateTicketRequestSchema.parse({
        ...changes,
        expectedRevision: baseRevision ?? ticket.revision,
      });
      await client.cancelQueries({ queryKey: detailKey });
      return adminApi.update(ticket.id, input);
    },
    onSuccess: (response) => {
      client.setQueryData(detailKey, response);
      setChanges({});
      setBaseRevision(null);
      setNotice('Ticket details updated.');
      void reload();
    },
    onError: () => {
      void refresh();
    },
  });
  const reply = useMutation({
    mutationFn: async (attempt: ReplyAttempt) => {
      await client.cancelQueries({ queryKey: detailKey });
      return adminApi.reply(ticket.id, attempt);
    },
    onSuccess: () => {
      dispatch({ type: 'sent' });
      setNotice('Public reply sent to the author.');
      void reload();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 409) dispatch({ type: 'conflict' });
      else if (ambiguous(error)) dispatch({ type: 'uncertain' });
      void refresh();
    },
  });
  const privateNote = useMutation({
    mutationFn: (body: string) => adminApi.note(ticket.id, body),
    onSuccess: () => {
      setNote('');
      setNoteUncertain(false);
      setNotice('Private note saved. It is not visible to the author.');
      void reload();
    },
    onError: (error) => {
      if (ambiguous(error)) setNoteUncertain(true);
      void refresh();
    },
  });
  const mutating = update.isPending || reply.isPending || privateNote.isPending;
  function change(values: TicketChanges) {
    setChanges((old) => ({ ...old, ...values }));
    setBaseRevision((old) => old ?? ticket.revision);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (updateBusy.current) return;
    setValidation('');
    updateBusy.current = true;
    try {
      await update.mutateAsync();
    } catch {
      /* Safe errors are rendered below. */
    } finally {
      updateBusy.current = false;
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (replyBusy.current) return;
    setValidation('');
    let attempt: ReplyAttempt;
    try {
      attempt = replyAttempt(editor, ticket.revision);
    } catch {
      setValidation('Enter a public reply between 1 and 10,000 characters.');
      return;
    }
    replyBusy.current = true;
    dispatch({ type: 'attempt', attempt });
    try {
      await reply.mutateAsync(attempt);
    } catch {
      /* Text and idempotency key are retained. */
    } finally {
      replyBusy.current = false;
    }
  }
  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (noteBusy.current || noteUncertain) return;
    const parsed = createNoteRequestSchema.safeParse({ body: note });
    if (!parsed.success) {
      setValidation('Enter a private note between 1 and 10,000 characters.');
      return;
    }
    setValidation('');
    noteBusy.current = true;
    try {
      await privateNote.mutateAsync(parsed.data.body);
    } catch {
      /* No automatic retry of append-only notes. */
    } finally {
      noteBusy.current = false;
    }
  }
  const staleEdit = baseRevision !== null && baseRevision !== ticket.revision;
  const staleReply = editor.baseRevision !== null && editor.baseRevision !== ticket.revision;
  return (
    <section>
      <Link
        className="back-link"
        to="/admin"
        onClick={(event) => {
          if (dirty) {
            event.preventDefault();
            setLeaving(true);
          }
        }}
      >
        ← Support queue
      </Link>
      {leaving && (
        <div role="alert" className="notice">
          <p>You have unsent text or unsaved changes. Leave this ticket and discard them?</p>
          <Link className="button" to="/admin">
            Discard and leave
          </Link>{' '}
          <button className="secondary" onClick={() => setLeaving(false)}>
            Keep editing
          </button>
        </div>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">{ticket.id}</p>
          <h1>{ticket.subject}</h1>
          <p>
            {ticket.author.displayName} · Author ID {ticket.author.id}
          </p>
          <p className="small muted">
            Opened {timestamp(ticket.createdAt)} · Updated {timestamp(ticket.updatedAt)}
          </p>
        </div>
        <Status value={ticket.status} />
      </div>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {validation && (
        <p role="alert" className="field-error">
          {validation}
        </p>
      )}
      <div className="admin-detail-grid">
        <div className="admin-conversation">
          <section className="panel">
            <h2>Author’s original question</h2>
            <p className="small muted">{ticket.book?.title ?? 'General / Account Level'}</p>
            <p className="plain-text">{ticket.description}</p>
          </section>
          <section className="public-thread" aria-labelledby="public-thread-heading">
            <h2 id="public-thread-heading">Public conversation</h2>
            <p className="small muted">The author can read everything in this section.</p>
            {ticket.replies.length ? (
              ticket.replies.map((item) => (
                <article key={item.id} className="panel reply">
                  <div className="reply-heading">
                    <strong>{item.senderDisplayName}</strong>
                    <time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time>
                  </div>
                  <p className="plain-text">{item.body}</p>
                </article>
              ))
            ) : (
              <p>No public replies yet.</p>
            )}
          </section>
          <section className="panel public-compose" aria-labelledby="reply-heading">
            <h2 id="reply-heading">Reply to author</h2>
            <form onSubmit={(event) => void send(event)}>
              <label htmlFor="public-reply">Public reply — visible to the author</label>
              <textarea
                id="public-reply"
                rows={9}
                maxLength={10000}
                value={editor.body}
                disabled={reply.isPending || editor.outcome === 'uncertain'}
                onChange={(event) =>
                  dispatch({ type: 'edit', body: event.target.value, revision: ticket.revision })
                }
                aria-describedby="reply-help"
              />
              <p id="reply-help" className="small muted">
                Review the final text before sending. Sending does not change ticket status.
              </p>
              {ticket.status === 'CLOSED' && (
                <p role="status">Reopen this ticket before sending a new reply.</p>
              )}
              {reply.error && <ErrorNotice error={reply.error} />}{' '}
              {(staleReply || editor.outcome === 'conflict') && editor.outcome !== 'uncertain' && (
                <div className="notice" role="alert">
                  <p>
                    The ticket changed since you started writing. Your text is preserved. Review the
                    current conversation and status before sending.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={mutating}
                    onClick={() => {
                      dispatch({ type: 'review', revision: ticket.revision });
                      reply.reset();
                    }}
                  >
                    I reviewed the latest ticket — keep my reply
                  </button>
                </div>
              )}
              {editor.outcome === 'uncertain' && (
                <div className="notice" role="alert">
                  <p>
                    Delivery is not confirmed. Your original text and request key are retained.
                    Retry the same send safely; do not create a new reply.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={mutating}
                    onClick={() => {
                      if (editor.attempt) reply.mutate(editor.attempt);
                    }}
                  >
                    Retry same send
                  </button>
                </div>
              )}
              <button
                disabled={
                  mutating ||
                  ticket.status === 'CLOSED' ||
                  staleReply ||
                  editor.outcome !== 'editing' ||
                  !editor.body.trim()
                }
              >
                {reply.isPending ? 'Sending public reply…' : 'Send public reply'}
              </button>
            </form>
          </section>
          <AiPanel
            ticketId={ticket.id}
            ticketRevision={ticket.revision}
            hasText={!!editor.body}
            locked={mutating || editor.outcome === 'uncertain'}
            onUse={(body) => dispatch({ type: 'use-draft', body, revision: ticket.revision })}
          />
          <section className="panel private-notes" aria-labelledby="notes-heading">
            <h2 id="notes-heading">Private notes — staff only</h2>
            <p className="small">Never shown to the author or copied into the reply editor.</p>
            {ticket.notes.map((item) => (
              <article key={item.id} className="private-note">
                <strong>{item.creator.displayName}</strong>
                <time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time>
                <p className="plain-text">{item.body}</p>
              </article>
            ))}
            {!ticket.notes.length && <p>No private notes yet.</p>}
            <form onSubmit={(event) => void addNote(event)}>
              <label htmlFor="private-note">New private note</label>
              <textarea
                id="private-note"
                rows={4}
                maxLength={10000}
                value={note}
                disabled={privateNote.isPending}
                onChange={(event) => setNote(event.target.value)}
              />
              {privateNote.error && <ErrorNotice error={privateNote.error} />}{' '}
              {noteUncertain && (
                <div className="notice" role="alert">
                  <p>
                    The note may have been saved. Check the notes above before retrying to avoid
                    duplication.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setNoteUncertain(false);
                      privateNote.reset();
                    }}
                  >
                    I checked the notes — allow another attempt
                  </button>
                </div>
              )}
              <button className="secondary" disabled={mutating || noteUncertain || !note.trim()}>
                {privateNote.isPending ? 'Saving note…' : 'Save private note'}
              </button>
            </form>
          </section>
        </div>
        <aside className="admin-sidebar">
          <section className="panel">
            <h2>Manage ticket</h2>
            <p>
              Assigned to: <strong>{ticket.assignee?.displayName ?? 'Unassigned'}</strong>
            </p>
            <Classification ticket={ticket} />
            <form onSubmit={(event) => void save(event)}>
              <fieldset disabled={mutating}>
                <label htmlFor="manage-status">Status</label>
                <select
                  id="manage-status"
                  value={changes.status ?? ticket.status}
                  onChange={(event) =>
                    change({ status: ticketStatusSchema.parse(event.target.value) })
                  }
                >
                  <option value={ticket.status}>{statusLabels[ticket.status]}</option>
                  {changes.status &&
                    changes.status !== ticket.status &&
                    !allowedStatusTransitions[ticket.status].includes(changes.status) && (
                      <option value={changes.status}>
                        {statusLabels[changes.status]} (previous selection; choose a valid
                        transition)
                      </option>
                    )}
                  {allowedStatusTransitions[ticket.status].map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
                <label htmlFor="manage-category">Category override</label>
                <select
                  id="manage-category"
                  value={changes.category ?? ticket.category ?? ''}
                  onChange={(event) =>
                    change({ category: categorySchema.parse(event.target.value) })
                  }
                >
                  <option value="" disabled>
                    Not classified
                  </option>
                  {categorySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {categoryLabels[value]}
                    </option>
                  ))}
                </select>
                <label htmlFor="manage-priority">Priority override</label>
                <select
                  id="manage-priority"
                  value={changes.priority ?? ticket.priority}
                  onChange={(event) =>
                    change({ priority: prioritySchema.parse(event.target.value) })
                  }
                >
                  {prioritySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {priorityLabels[value]}
                    </option>
                  ))}
                </select>
                <p className="small muted">
                  Only changed fields are saved. Category and priority overrides are independent.
                </p>
                <div className="assignment-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => change({ assignmentAction: 'SELF' })}
                  >
                    Assign to me
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => change({ assignmentAction: 'UNASSIGN' })}
                  >
                    Unassign
                  </button>
                </div>
                {changes.assignmentAction && (
                  <p role="status">
                    Will{' '}
                    {changes.assignmentAction === 'SELF' ? 'assign to you' : 'clear assignment'}{' '}
                    when saved.
                  </p>
                )}
                {update.error && <ErrorNotice error={update.error} />}{' '}
                {staleEdit && (
                  <div role="alert" className="notice">
                    <p>
                      This ticket changed. Your selections are retained; compare them with the
                      current values above.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setBaseRevision(ticket.revision);
                        update.reset();
                      }}
                    >
                      I reviewed the latest ticket — keep my changes
                    </button>
                  </div>
                )}
                <div className="form-actions">
                  <button disabled={mutating || staleEdit || !Object.keys(changes).length}>
                    {update.isPending ? 'Saving…' : 'Save ticket changes'}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setChanges({});
                      setBaseRevision(null);
                      update.reset();
                    }}
                  >
                    Discard changes
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
          {ticket.book ? (
            <BookContext id={ticket.book.id} />
          ) : (
            <section className="panel">
              <h2>Account-level question</h2>
              <p>
                No book is linked. Author: {ticket.author.displayName} ({ticket.author.id}).
              </p>
              <p className="small muted">
                Banking details and account transaction history are not available.
              </p>
            </section>
          )}
          <section className="panel">
            <h2>Change history</h2>
            {ticket.events.length ? (
              <ol className="change-history">
                {ticket.events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.type.replaceAll('_', ' ').toLowerCase()}</strong>
                    <p>
                      {event.oldValue ?? 'None'} → {event.newValue ?? 'None'}
                    </p>
                    <span className="small muted">
                      {event.actor?.displayName ?? 'AI / system'} · {timestamp(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No changes recorded.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
export function AdminTicket() {
  const { id = '' } = useParams();
  const { session } = useSession();
  const query = useQuery({
    queryKey: ['admin-ticket', session.data?.id, id],
    queryFn: ({ signal }) => adminApi.detail(id, signal),
    ...polling,
  });
  return (
    <>
      {query.isPending && <Loading>Loading ticket…</Loading>}
      {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}{' '}
      {query.data && (
        <AdminTicketContent
          key={`${session.data?.id}:${id}`}
          ticket={query.data.data}
          refresh={() => query.refetch()}
        />
      )}
    </>
  );
}
