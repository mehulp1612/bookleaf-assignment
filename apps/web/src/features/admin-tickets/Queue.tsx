import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ticketStatusSchema,
  statusLabels,
  categorySchema,
  categoryLabels,
  prioritySchema,
  priorityLabels,
} from '@bookleaf/contracts';
import { useSession } from '../auth/session';
import { polling } from '../../shared/queries';
import { ErrorNotice, Loading, Pagination, Status } from '../../shared/ui';
import { timestamp } from '../../shared/format';
import { adminApi } from './api';
import { ageLabel, parseQueue, queueSearch } from './model';

export function AdminQueue() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const parsed = parseQueue(params);
  const search = parsed.success ? queueSearch(params) : '';
  const query = useQuery({
    queryKey: ['admin-tickets', session.data?.id, search],
    queryFn: ({ signal }) => adminApi.list(search, signal),
    enabled: parsed.success,
    ...polling,
  });
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set('page', '1');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  const select = (
    name: string,
    label: string,
    options: readonly string[],
    labels: Record<string, string>,
  ) => (
    <div>
      <label htmlFor={`queue-${name}`}>{label}</label>
      <select
        id={`queue-${name}`}
        value={params.get(name) ?? ''}
        onChange={(e) => change(name, e.target.value)}
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((value) => (
          <option key={value} value={value}>
            {labels[value]}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BOOKLEAF SUPPORT DESK</p>
          <h1>Support queue</h1>
          <p className="muted">The most urgent, oldest unresolved questions come first.</p>
        </div>
        <span className="badge">Administrator</span>
      </div>
      <div className="filters admin-filters">
        {select('status', 'Status', ticketStatusSchema.options, statusLabels)}
        {select('category', 'Category', categorySchema.options, categoryLabels)}
        {select('priority', 'Priority', prioritySchema.options, priorityLabels)}
        <div>
          <label htmlFor="queue-from">Created from (UTC)</label>
          <input
            id="queue-from"
            type="date"
            value={params.get('createdFrom') ?? ''}
            onChange={(e) => change('createdFrom', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="queue-to">Created through (UTC)</label>
          <input
            id="queue-to"
            type="date"
            value={params.get('createdTo') ?? ''}
            onChange={(e) => change('createdTo', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="queue-sort">Order</label>
          <select
            id="queue-sort"
            value={params.get('sort') ?? 'queue'}
            onChange={(e) => change('sort', e.target.value)}
          >
            <option value="queue">Urgency, then age</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        <button className="secondary" onClick={() => setParams({})}>
          Clear filters
        </button>
      </div>
      {!parsed.success && (
        <p role="alert" className="error-notice">
          Check your filters: {parsed.error.issues.map((issue) => issue.message).join(' ')}
        </p>
      )}
      <p className="small muted">
        Updates every five seconds while visible. Age is time since submission, not a promised
        response deadline.
      </p>
      {parsed.success && query.isPending && <Loading>Loading support queue…</Loading>}
      {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}{' '}
      {parsed.success && query.data && (
        <>
          {query.data.data.length ? (
            <ul className="ticket-list">
              {query.data.data.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    className={`panel ticket-row priority-border-${ticket.priority.toLowerCase()}`}
                    to={`/admin/tickets/${encodeURIComponent(ticket.id)}`}
                  >
                    <div>
                      <p className="small muted">
                        {ticket.author.displayName} ·{' '}
                        {ticket.book?.title ?? 'General / Account Level'}
                      </p>
                      <h2>{ticket.subject}</h2>
                      <p className="small muted">
                        {ticket.category ? categoryLabels[ticket.category] : 'Not classified'} ·{' '}
                        {ticket.assignee
                          ? `Assigned to ${ticket.assignee.displayName}`
                          : 'Unassigned'}
                      </p>
                      <time dateTime={ticket.createdAt} title={timestamp(ticket.createdAt)}>
                        {ageLabel(ticket.createdAt)} · {timestamp(ticket.createdAt)}
                      </time>
                    </div>
                    <span className={`badge priority-${ticket.priority.toLowerCase()}`}>
                      {priorityLabels[ticket.priority]}
                      {ticket.prioritySource === 'DEFAULT' ? ' (provisional)' : ''}
                    </span>
                    <Status value={ticket.status} />
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="panel empty">
              <h2>No tickets match</h2>
              <p>Try changing the filters. New author questions will appear here.</p>
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
