import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  authorTicketQuerySchema,
  endpoints,
  statusLabels,
  ticketStatusSchema,
} from '@bookleaf/contracts';
import { request } from '../../shared/api';
import { polling } from '../../shared/queries';
import { ErrorNotice, Loading, Pagination, Status } from '../../shared/ui';
import { timestamp } from '../../shared/format';
import { useSession } from '../auth/session';

export function Tickets() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const parsed = authorTicketQuerySchema.safeParse(Object.fromEntries(params));
  const filters = parsed.success ? parsed.data : authorTicketQuerySchema.parse({});
  const search = new URLSearchParams(
    Object.entries(filters).map(([key, value]) => [key, String(value)]),
  ).toString();
  const query = useQuery({
    queryKey: ['tickets', session.data?.id, search],
    queryFn: ({ signal }) =>
      request(`/api/v1/tickets?${search}`, endpoints.authorTickets.response, { signal }),
    ...polling,
  });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set('page', '1');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A DIRECT LINE TO YOUR TEAM</p>
          <h1>My questions</h1>
          <p className="muted">Keep track of your conversations with BookLeaf.</p>
        </div>
        <Link className="button" to="/tickets/new">
          Ask a question
        </Link>
      </div>
      <div className="filters">
        <div>
          <label htmlFor="status-filter">Status</label>
          <select
            id="status-filter"
            value={filters.status ?? ''}
            onChange={(e) => filter('status', e.target.value)}
          >
            <option value="">All statuses</option>
            {ticketStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort-filter">Order</label>
          <select
            id="sort-filter"
            value={filters.sort}
            onChange={(e) => filter('sort', e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>
      {!parsed.success && (
        <p role="alert">
          The address contained invalid filters. Showing all questions.{' '}
          <button className="secondary" onClick={() => setParams({})}>
            Reset filters
          </button>
        </p>
      )}
      <p className="small muted">
        Updates automatically while this page is visible.{' '}
        {query.dataUpdatedAt > 0 &&
          `Last checked ${new Date(query.dataUpdatedAt).toLocaleTimeString('en-IN')}.`}
      </p>
      {query.isPending && <Loading>Loading your questions…</Loading>}
      {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}
      {query.data && (
        <>
          {query.data.data.length ? (
            <ul className="ticket-list">
              {query.data.data.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    to={`/tickets/${encodeURIComponent(ticket.id)}`}
                    className="panel ticket-row"
                  >
                    <div>
                      <p className="small muted">
                        {ticket.book?.title ?? 'General / Account Level'}
                      </p>
                      <h2>{ticket.subject}</h2>
                      <p className="small muted">
                        Opened {timestamp(ticket.createdAt)} · Updated {timestamp(ticket.updatedAt)}
                      </p>
                    </div>
                    <Status value={ticket.status} />
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="panel empty">
              <h2>No questions here yet</h2>
              <p>
                {filters.status
                  ? 'Try another status or start a new conversation.'
                  : 'When you ask a question, you can follow its progress here.'}
              </p>
              <Link to="/tickets/new">Ask your first question</Link>
            </div>
          )}
          <Pagination
            {...query.data.meta}
            change={(page) => {
              const next = new URLSearchParams(params);
              next.set('page', String(page));
              setParams(next);
            }}
          />
        </>
      )}
    </section>
  );
}
export function TicketDetail() {
  const { session } = useSession();
  const { id = '' } = useParams();
  const location = useLocation();
  const query = useQuery({
    queryKey: ['ticket', session.data?.id, id],
    queryFn: ({ signal }) =>
      request(`/api/v1/tickets/${encodeURIComponent(id)}`, endpoints.authorTicket.response, {
        signal,
      }),
    ...polling,
  });
  const ticket = query.data?.data;
  return (
    <section className="detail-page">
      <Link className="back-link" to="/tickets">
        ← My questions
      </Link>
      {query.isPending && <Loading>Loading your question…</Loading>}
      {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}{' '}
      {ticket && (
        <>
          {location.state?.created && (
            <p className="notice" role="status">
              Your question has been sent. Replies will appear below.
            </p>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">{ticket.book?.title ?? 'General / Account Level'}</p>
              <h1>{ticket.subject}</h1>
              <p className="small muted">
                Opened {timestamp(ticket.createdAt)} · Updated {timestamp(ticket.updatedAt)}
              </p>
            </div>
            <Status value={ticket.status} />
          </div>
          <article className="panel">
            <h2>Your original question</h2>
            <p className="plain-text">{ticket.description}</p>
          </article>
          <section className="conversation" aria-labelledby="replies-heading">
            <h2 id="replies-heading">Replies from BookLeaf</h2>
            <p className="small muted">Updates automatically while this page is visible.</p>
            <p className="sr-only" role="status">
              {ticket.replies.length} {ticket.replies.length === 1 ? 'reply' : 'replies'}. Status:{' '}
              {statusLabels[ticket.status]}.
            </p>
            {ticket.replies.length ? (
              ticket.replies.map((reply) => (
                <article className="panel reply" key={reply.id}>
                  <div className="reply-heading">
                    <strong>{reply.senderDisplayName}</strong>
                    <time dateTime={reply.createdAt}>{timestamp(reply.createdAt)}</time>
                  </div>
                  <p className="plain-text">{reply.body}</p>
                </article>
              ))
            ) : (
              <div className="panel empty">
                <h3>No replies yet</h3>
                <p>
                  Your question is with the support team. You can return here to check for a
                  response.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
