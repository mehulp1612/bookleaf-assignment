import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  adminTicketFixture,
  adminUserFixture,
  pendingDraftFixture,
  failedDraftFixture,
} from '@bookleaf/contracts/fixtures';
import { type AiDraft } from '@bookleaf/contracts';
import { SessionProvider } from '../src/features/auth/session';
import { createQueryClient, sessionKey } from '../src/shared/queries';
import {
  editorReducer,
  emptyEditor,
  replyAttempt,
  parseQueue,
  queueSearch,
  ageLabel,
} from '../src/features/admin-tickets/model';
import { AdminQueue } from '../src/features/admin-tickets/Queue';
import { AdminTicketContent } from '../src/features/admin-tickets/Detail';
import { AiPanel } from '../src/features/admin-tickets/AiPanel';
import {
  createDraftFixtureApi,
  readyDraftFixture,
} from '../src/features/admin-tickets/ai-fixtures';
import { canRequestDraft, httpDraftApi, type DraftLookup } from '../src/features/admin-tickets/ai';
import { adminApi } from '../src/features/admin-tickets/api';
import { ApiClientError } from '../src/shared/api';

test('admin queue validates all filters, inclusive date ranges, paging and age cues', () => {
  const params = new URLSearchParams({
    status: 'OPEN',
    category: 'ISBN_METADATA',
    priority: 'HIGH',
    createdFrom: '2026-01-01',
    createdTo: '2026-01-31',
    page: '2',
    pageSize: '10',
    sort: 'queue',
  });
  assert.equal(parseQueue(params).success, true);
  assert.equal(new URLSearchParams(queueSearch(params)).get('page'), '2');
  for (const invalid of [
    'createdFrom=2026-02-30',
    'createdFrom=2026-02-01&createdTo=2026-01-01',
    'priority=URGENT',
    'sort=random',
    'pageSize=101',
    'authorId=other',
  ])
    assert.equal(parseQueue(new URLSearchParams(invalid)).success, false, invalid);
  assert.equal(ageLabel('2026-01-01T00:00:00Z', Date.parse('2026-01-03T00:00:00Z')), '2d old');
  assert.equal(ageLabel('2026-01-01T00:00:00Z', Date.parse('2025-01-01T00:00:00Z')), '0m old');
  const client = createQueryClient();
  client.setQueryData(sessionKey, adminUserFixture);
  client.setQueryData(['admin-tickets', adminUserFixture.id, queueSearch(params)], {
    data: [{ ...adminTicketFixture, priority: 'HIGH' }],
    meta: { page: 2, pageSize: 10, total: 21 },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin?${params}`]}>
        <SessionProvider>
          <AdminQueue />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  for (const text of [
    'Support queue',
    'Created from (UTC)',
    'Created through (UTC)',
    'Category',
    'Priority',
    'High (provisional)',
    'Page 2 of 3',
    '21 total',
    adminTicketFixture.author.displayName,
  ])
    assert.ok(html.includes(text), text);
  client.clear();
});

test('dirty reply model survives new revisions, conflict review, uncertain delivery and exact retry', () => {
  let state = editorReducer(emptyEditor, { type: 'edit', body: 'My reviewed reply', revision: 4 });
  const attempt = replyAttempt(state, 8, () => 'stable-request-key');
  assert.equal(attempt.expectedRevision, 4);
  state = editorReducer(state, { type: 'attempt', attempt });
  state = editorReducer(state, { type: 'uncertain' });
  assert.deepEqual(
    replyAttempt(state, 99, () => 'must-not-be-used'),
    attempt,
  );
  assert.deepEqual(
    editorReducer(state, { type: 'use-draft', body: 'Late AI output', revision: 100 }),
    state,
  );
  assert.deepEqual(
    editorReducer(state, { type: 'edit', body: 'Different content', revision: 100 }),
    state,
  );
  state = editorReducer(state, { type: 'conflict' });
  assert.equal(state.body, 'My reviewed reply');
  assert.equal(state.baseRevision, 4);
  state = editorReducer(state, { type: 'review', revision: 9 });
  assert.equal(state.body, 'My reviewed reply');
  assert.equal(state.outcome, 'editing');
  const reviewed = replyAttempt(state, 9, () => 'new-key-after-review');
  assert.equal(reviewed.expectedRevision, 9);
  assert.notEqual(reviewed.key, attempt.key);
  state = editorReducer(state, {
    type: 'use-draft',
    body: 'Explicitly chosen draft',
    revision: 10,
  });
  assert.equal(state.body, 'Explicitly chosen draft');
  assert.equal(state.baseRevision, 9);
  assert.deepEqual(editorReducer(state, { type: 'sent' }), emptyEditor);
  assert.throws(() => replyAttempt(emptyEditor, 0));
});

test('AI fixtures model cache reuse, pending/failure/success without automatic POST or editor changes', async () => {
  const fixture = createDraftFixtureApi();
  const initial = await fixture.api.latest('ticket');
  assert.equal(canRequestDraft(initial, false), true);
  assert.equal(canRequestDraft(initial, true), false);
  await fixture.api.generate('ticket', false);
  assert.equal(canRequestDraft(await fixture.api.latest('ticket'), false), false);
  fixture.complete();
  const cached = await fixture.api.latest('ticket');
  assert.equal(canRequestDraft(cached, false), false);
  assert.equal(canRequestDraft(cached, true), true);
  assert.deepEqual(await fixture.api.latest('ticket'), cached);
  assert.equal(fixture.calls.filter((c) => c.method === 'POST').length, 1);
  fixture.fail();
  const failed = await fixture.api.latest('ticket');
  assert.equal(canRequestDraft(failed, true), true);
  assert.equal(canRequestDraft({ available: false }, false), false);
});

test('AI panels render honest unavailable/pending/failure/stale states and never send drafts implicitly', () => {
  const states: [DraftLookup, string][] = [
    [{ available: false }, 'AI drafts are unavailable'],
    [{ available: true, draft: { state: 'NOT_REQUESTED' } }, 'Request AI draft'],
    [{ available: true, draft: pendingDraftFixture }, 'Draft queued'],
    [
      { available: true, draft: { ...pendingDraftFixture, state: 'RUNNING' } as AiDraft },
      'Draft generation in progress',
    ],
    [{ available: true, draft: failedDraftFixture }, 'Draft generation failed'],
    [{ available: true, draft: readyDraftFixture }, 'Use draft in reply editor'],
    [
      { available: true, draft: { ...readyDraftFixture, stale: true } as AiDraft },
      'This draft is stale',
    ],
  ];
  for (const [value, text] of states) {
    const client = createQueryClient();
    client.setQueryData(sessionKey, adminUserFixture);
    client.setQueryData(['admin-draft', adminUserFixture.id, 'ticket', 0], value);
    let copied = false;
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SessionProvider>
            <AiPanel
              ticketId="ticket"
              ticketRevision={0}
              hasText
              locked={false}
              onUse={() => {
                copied = true;
              }}
            />
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    assert.ok(html.includes(text), text);
    assert.equal(copied, false);
    assert.equal(html.includes('Send public reply'), false);
    client.clear();
  }
});

test('admin detail separates staff notes and public replies, offers manual handling without AI', () => {
  const client = createQueryClient();
  client.setQueryData(sessionKey, adminUserFixture);
  client.setQueryData(['admin-draft', adminUserFixture.id, adminTicketFixture.id, 0], {
    available: false,
  });
  const ticket = {
    ...adminTicketFixture,
    book: null,
    description: '<script>not executable</script>',
  };
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionProvider>
          <AdminTicketContent ticket={ticket} refresh={async () => {}} />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  for (const text of [
    'Private notes — staff only',
    'New private note',
    'Save private note',
    'Public reply — visible to the author',
    'Send public reply',
    'Category override',
    'Priority override',
    'Assign to me',
    'Unassign',
    'AI drafts are unavailable',
    'Account-level question',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('Private investigation note.'));
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /<textarea[^>]*id="public-reply"[^>]*><\/textarea>/);
  assert.match(html, /<textarea[^>]*id="private-note"[^>]*><\/textarea>/);
  client.clear();
});

test('manual and AI HTTP adapters keep methods, idempotency, errors and payloads separate', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body: unknown; key: string | null }[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      const path = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({
        url: path,
        method: init?.method ?? 'GET',
        body,
        key: new Headers(init?.headers).get('Idempotency-Key'),
      });
      if (path.endsWith('/ai-drafts/latest'))
        return new Response(
          JSON.stringify({
            error: { code: 'NOT_FOUND', message: 'Resource not found.', requestId: 'test' },
          }),
          { status: 404 },
        );
      if (path.endsWith('/ai-drafts'))
        return Response.json({ data: pendingDraftFixture }, { status: 202 });
      if (path.endsWith('/replies'))
        return Response.json(
          {
            data: {
              id: 'reply',
              body: 'Reviewed',
              senderDisplayName: 'Admin',
              createdAt: '2026-01-01T00:00:00Z',
            },
          },
          { status: 201 },
        );
      if (path.endsWith('/notes'))
        return Response.json(
          {
            data: {
              id: 'note',
              body: 'Private',
              creator: { id: 'admin', displayName: 'Admin' },
              createdAt: '2026-01-01T00:00:00Z',
            },
          },
          { status: 201 },
        );
      return Response.json({ data: adminTicketFixture });
    };
    await adminApi.update('ticket', { expectedRevision: 3, category: 'ISBN_METADATA' });
    assert.deepEqual(calls[0]?.body, { expectedRevision: 3, category: 'ISBN_METADATA' });
    await adminApi.reply('ticket', { key: 'same-key', body: 'Reviewed', expectedRevision: 3 });
    await adminApi.reply('ticket', { key: 'same-key', body: 'Reviewed', expectedRevision: 3 });
    assert.deepEqual(calls[1], calls[2]);
    assert.equal(calls[1]?.key, 'same-key');
    assert.deepEqual(calls[1]?.body, { body: 'Reviewed', expectedRevision: 3 });
    await adminApi.note('ticket', 'Private');
    assert.deepEqual(calls[3]?.body, { body: 'Private' });
    assert.equal(calls[3]?.key, null);
    assert.deepEqual(await httpDraftApi.latest('ticket'), { available: false });
    assert.equal(calls[4]?.method, 'GET');
    await httpDraftApi.generate('ticket', true);
    assert.equal(calls[5]?.method, 'POST');
    assert.deepEqual(calls[5]?.body, { regenerate: true });
    globalThis.fetch = async () =>
      Response.json(
        { error: { code: 'CONFLICT', message: 'Reload the ticket.', requestId: 'test' } },
        { status: 409 },
      );
    await assert.rejects(
      adminApi.update('ticket', { expectedRevision: 0, priority: 'HIGH' }),
      (error) => error instanceof ApiClientError && error.status === 409,
    );
    globalThis.fetch = async () =>
      Response.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Unavailable', requestId: 'test' } },
        { status: 500 },
      );
    await assert.rejects(
      httpDraftApi.latest('ticket'),
      (error) => error instanceof ApiClientError && error.status === 500,
    );
  } finally {
    globalThis.fetch = original;
  }
});
