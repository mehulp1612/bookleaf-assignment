import type { ReactNode } from 'react';
import { ApiClientError } from './api';
import { statusLabels, type TicketStatus } from '@bookleaf/contracts';

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <p>
        {error instanceof ApiClientError
          ? error.message
          : 'We could not connect. Check your connection and try again.'}
      </p>
      {retry && (
        <button type="button" className="secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <p role="status" className="muted">
      {children}
    </p>
  );
}
export function Status({ value }: { value: TicketStatus }) {
  return <span className={`badge status-${value.toLowerCase()}`}>{statusLabels[value]}</span>;
}
export function Pagination({
  page,
  pageSize,
  total,
  change,
}: {
  page: number;
  pageSize: number;
  total: number;
  change: (page: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="secondary"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {Math.max(1, Math.ceil(total / pageSize))} · {total} total
      </span>
      <button
        type="button"
        className="secondary"
        disabled={page * pageSize >= total}
        onClick={() => change(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
