import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  authorUserFixture,
  publishedBookFixture,
  productionBookFixture,
  adminTicketFixture,
} from '@bookleaf/contracts/fixtures';
import { createQueryClient, sessionKey } from '../src/shared/queries';
import { SessionProvider } from '../src/features/auth/session';
import { Books } from '../src/features/books/Books';
import { TicketDetail } from '../src/features/author-tickets/Tickets';
import { TicketForm } from '../src/features/author-tickets/TicketForm';

test('book page renders every required field, exact money, production nulls and placeholder ISBNs', () => {
  const client = createQueryClient();
  client.setQueryData(sessionKey, authorUserFixture);
  client.setQueryData(['books', authorUserFixture.id, 1], {
    data: [publishedBookFixture, productionBookFixture],
    meta: { page: 1, pageSize: 6, total: 2 },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionProvider>
          <Books />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  for (const text of [
    'Whispers of the Ganges',
    '978-93-5XXXX-01-1',
    'Literary Fiction',
    'Publication date',
    'MRP',
    'Royalty per copy',
    'Copies sold',
    'Royalty earned',
    'Royalty paid',
    'Royalty pending',
    'Last royalty payout',
    'Print partner',
    'Available on',
    '₹3,570.00',
    'In Production - Cover Design',
    'Not available',
    '₹0.00',
  ])
    assert.ok(html.includes(text), text);
  client.clear();
});
test('ticket page omits private data and escapes public text; form labels attachment preview truthfully', () => {
  const client = createQueryClient();
  client.setQueryData(sessionKey, authorUserFixture);
  client.setQueryData(['ticket', authorUserFixture.id, 'fixture-ticket'], {
    data: { ...adminTicketFixture, description: '<script>alert("x")</script>' },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tickets/fixture-ticket']}>
        <SessionProvider>
          <Routes>
            <Route path="/tickets/:id" element={<TicketDetail />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  assert.equal(html.includes('Private investigation note.'), false);
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  client.setQueryData(['book-options', authorUserFixture.id], [publishedBookFixture]);
  const form = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tickets/new?bookId=BK001']}>
        <SessionProvider>
          <TicketForm />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  assert.ok(form.includes('Files are not uploaded or sent.'));
  assert.ok(form.includes('General / Account Level'));
  assert.ok(form.includes('for="subject"'));
  assert.ok(form.includes('for="description"'));
  assert.match(form, /maxlength="10000"/i);
  client.clear();
});
