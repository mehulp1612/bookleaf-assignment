import { useState, useRef, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTicketRequestSchema, endpoints } from '@bookleaf/contracts';
import { request, ApiClientError } from '../../shared/api';
import { ErrorNotice, Loading } from '../../shared/ui';
import { allBooks } from '../books/Books';
import { useSession } from '../auth/session';

export function TicketForm() {
  const { session, draft, setDraft } = useSession();
  const ownerId = session.data!.id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const current =
    draft?.ownerId === ownerId
      ? draft
      : { ownerId, bookId: params.get('bookId') ?? '', subject: '', description: '' };
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const books = useQuery({
    queryKey: ['book-options', ownerId],
    queryFn: ({ signal }) => allBooks(signal),
  });
  const mutation = useMutation({
    mutationFn: (input: ReturnType<typeof createTicketRequestSchema.parse>) =>
      request('/api/v1/tickets', endpoints.createTicket.response, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
  const change = (field: 'bookId' | 'subject' | 'description', value: string) => {
    setDraft({ ...current, [field]: value });
    setErrors((old) => ({ ...old, [field]: [] }));
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || uncertain) return;
    const parsed = createTicketRequestSchema.safeParse({
      bookId: current.bookId || null,
      subject: current.subject,
      description: current.description,
    });
    const invalid: Record<string, string[]> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        (invalid[String(issue.path[0])] ??= []).push(issue.message);
    if (current.bookId && !books.data?.some((book) => book.id === current.bookId))
      invalid.bookId = ['Choose a book from your account, or General / Account Level.'];
    if (!parsed.success || Object.keys(invalid).length) {
      setErrors(invalid);
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    // Keep even a preselected-book-only draft when authentication expires during submission.
    setDraft(current);
    busy.current = true;
    try {
      const response = await mutation.mutateAsync(parsed.data);
      setDraft(null);
      void client.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${encodeURIComponent(response.data.id)}`, {
        replace: true,
        state: { created: true },
      });
    } catch (error) {
      if (error instanceof ApiClientError) setErrors(error.fieldErrors);
      // Creation has no idempotency key; an ambiguous response must not trigger an automatic resend.
      if (
        !(error instanceof ApiClientError) ||
        error.status >= 500 ||
        error.code === 'INVALID_RESPONSE'
      )
        setUncertain(true);
    } finally {
      busy.current = false;
    }
  }
  return (
    <section className="form-page">
      <Link className="back-link" to="/tickets">
        ← My questions
      </Link>
      <h1>How can we help?</h1>
      <p className="muted">Tell us what you need. Your publishing team will reply here.</p>
      <form ref={form} className="panel" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset disabled={mutation.isPending}>
          <label htmlFor="book">Book</label>
          <select
            id="book"
            value={current.bookId}
            onChange={(e) => change('bookId', e.target.value)}
            aria-invalid={!!errors.bookId?.length}
            aria-describedby="book-help book-error"
          >
            <option value="">General / Account Level</option>
            {current.bookId && !books.data?.some((b) => b.id === current.bookId) && (
              <option value={current.bookId}>Selected book unavailable</option>
            )}
            {books.data?.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title} — {book.status}
              </option>
            ))}
          </select>
          <p id="book-help" className="small muted">
            Choose one of your books, including books in production, or ask a general question.
          </p>
          <p id="book-error" className="field-error">
            {errors.bookId?.join(' ')}
          </p>
          {books.isPending && <Loading>Loading your books…</Loading>}
          {books.error && <ErrorNotice error={books.error} retry={() => void books.refetch()} />}
          <label htmlFor="subject">Subject</label>
          <input
            id="subject"
            value={current.subject}
            onChange={(e) => change('subject', e.target.value)}
            maxLength={200}
            required
            aria-invalid={!!errors.subject?.length}
            aria-describedby="subject-help subject-error"
          />
          <p id="subject-help" className="small muted">
            A short summary, up to 200 characters.
          </p>
          <p id="subject-error" className="field-error">
            {errors.subject?.join(' ')}
          </p>
          <label htmlFor="description">Your question</label>
          <textarea
            id="description"
            rows={8}
            value={current.description}
            onChange={(e) => change('description', e.target.value)}
            maxLength={10000}
            required
            aria-invalid={!!errors.description?.length}
            aria-describedby="description-help description-error"
          />
          <p id="description-help" className="small muted">
            Include the details that will help us understand.{' '}
            {current.description.length.toLocaleString('en-IN')} / 10,000 characters.
          </p>
          <p id="description-error" className="field-error">
            {errors.description?.join(' ')}
          </p>
          <div className="attachment-box">
            <label htmlFor="attachments">Attachments (optional preview)</label>
            <input
              id="attachments"
              type="file"
              multiple
              aria-describedby="attachment-notice"
              onChange={(e) =>
                setFileNames(Array.from(e.target.files ?? []).map((file) => file.name))
              }
            />
            <p id="attachment-notice">
              <strong>Files are not uploaded or sent.</strong> Selection is a preview only; support
              will not receive these files. Describe the issue in your question.
            </p>
            {fileNames.length > 0 && (
              <ul>
                {fileNames.map((name, i) => (
                  <li key={`${i}-${name}`}>{name} — not sent</li>
                ))}
              </ul>
            )}
          </div>
          {Object.keys(errors).length > 0 && Object.values(errors).some((e) => e.length) && (
            <p className="field-error" role="alert">
              Please check the highlighted fields.
            </p>
          )}
          {mutation.error && <ErrorNotice error={mutation.error} />}
          {uncertain && (
            <div className="notice" role="alert">
              <p>
                We could not confirm whether your question was saved. Check{' '}
                <Link to="/tickets" target="_blank" rel="noopener">
                  My questions in a new tab
                </Link>{' '}
                before sending again to avoid a duplicate. Your text is still here.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setUncertain(false);
                  mutation.reset();
                }}
              >
                I checked — allow another attempt
              </button>
            </div>
          )}
          <div className="form-actions">
            <button disabled={mutation.isPending || uncertain || (!!current.bookId && !books.data)}>
              {mutation.isPending ? 'Sending…' : 'Send question'}
            </button>
            <Link to="/tickets">Back to my questions</Link>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
