import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { endpoints, type Book } from '@bookleaf/contracts';
import { request } from '../../shared/api';
import { money, calendarDate } from '../../shared/format';
import { ErrorNotice, Loading, Pagination } from '../../shared/ui';
import { useSession } from '../auth/session';

export async function allBooks(signal: AbortSignal) {
  const books: Book[] = [];
  let page = 1;
  while (true) {
    const result = await request(
      `/api/v1/books?page=${page}&pageSize=100`,
      endpoints.books.response,
      { signal },
    );
    books.push(...result.data);
    if (books.length >= result.meta.total || result.data.length === 0) return books;
    page++;
  }
}
function BookCard({ book }: { book: Book }) {
  const fields = [
    ['ISBN', book.isbn],
    ['Genre', book.genre || 'Not available'],
    ['Publication date', calendarDate(book.publicationDate)],
    ['MRP', money(book.mrpPaise)],
    ['Royalty per copy', money(book.authorRoyaltyPerCopyPaise)],
    ['Copies sold', new Intl.NumberFormat('en-IN').format(book.totalCopiesSold)],
    ['Royalty earned', money(book.totalRoyaltyEarnedPaise)],
    ['Royalty paid', money(book.royaltyPaidPaise)],
    ['Royalty pending', money(book.royaltyPendingPaise)],
    ['Last royalty payout', calendarDate(book.lastRoyaltyPayoutDate)],
    ['Print partner', book.printPartner ?? 'Not available'],
    ['Available on', book.availableOn.length ? book.availableOn.join(', ') : 'No platforms listed'],
  ];
  return (
    <article className="panel book-card">
      <div className="book-heading">
        <span className="book-mark" aria-hidden="true">
          B
        </span>
        <div>
          <p className="eyebrow">{book.id}</p>
          <h2>{book.title}</h2>
          <span className="badge">{book.status}</span>
        </div>
      </div>
      <dl className="book-facts">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <Link className="text-link" to={`/tickets/new?bookId=${encodeURIComponent(book.id)}`}>
        Ask about this book <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
export function Books() {
  const { session } = useSession();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['books', session.data?.id, page],
    queryFn: ({ signal }) =>
      request(`/api/v1/books?page=${page}&pageSize=6`, endpoints.books.response, { signal }),
  });
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR PUBLISHING JOURNEY</p>
          <h1>My books</h1>
          <p className="muted">Publication details and royalty information, in one place.</p>
        </div>
        <Link className="button" to="/tickets/new">
          Ask a question
        </Link>
      </div>
      <p className="small muted">
        All amounts are in INR. Royalty figures are recorded snapshots, not a payment schedule. “Not
        available” means the information has not been supplied.
      </p>
      {query.isPending && <Loading>Loading your books…</Loading>}
      {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}
      {query.data && (
        <>
          {query.data.data.length ? (
            <div className="book-grid">
              {query.data.data.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          ) : (
            <div className="panel empty">
              <h2>No books to show</h2>
              <p>You can still raise a general or account-level question.</p>
              <Link to="/tickets/new">Contact support</Link>
            </div>
          )}
          <Pagination {...query.data.meta} change={setPage} />
        </>
      )}
    </section>
  );
}
