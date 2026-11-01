import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  QueryObserver,
  environmentManager,
  focusManager,
  timeoutManager,
} from '@tanstack/react-query';
import { money, calendarDate } from '../src/shared/format';
import { request, ApiClientError } from '../src/shared/api';
import {
  createQueryClient,
  polling,
  pollDelay,
  replaceSession,
  sessionKey,
  sessionExpiredKey,
} from '../src/shared/queries';

test('money distinguishes missing/zero, exact fractions, large safe values and calendar dates', () => {
  assert.equal(money(null), 'Not available');
  assert.equal(money(0), '₹0.00');
  assert.equal(money(29), '₹0.29');
  assert.equal(money(357000), '₹3,570.00');
  assert.equal(money(Number.MAX_SAFE_INTEGER), '₹9,00,71,99,25,47,409.91');
  assert.equal(calendarDate(null), 'Not available');
  assert.equal(calendarDate('2024-02-29'), '29 Feb 2024');
});

test('API client uses same-origin cookies/CSRF and validates success, safe field errors, malformed responses and aborts', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (path, init) => {
      calls++;
      assert.equal(path, '/api/v1/tickets');
      assert.equal(init?.credentials, 'same-origin');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('x-bookleaf-request'), '1');
      assert.equal(headers.get('content-type'), 'application/json');
      assert.ok(init?.signal);
      return new Response(JSON.stringify({ data: 'ok' }), { status: 201 });
    };
    assert.deepEqual(
      await request('/api/v1/tickets', z.object({ data: z.string() }), {
        method: 'POST',
        body: '{}',
      }),
      { data: 'ok' },
    );
    for (const path of ['https://example.com', '//example.com', '/\\example.com'])
      await assert.rejects(request(path, z.unknown()));
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Check fields.',
            requestId: 'safe-id',
            fieldErrors: { subject: ['Required'] },
          },
        }),
        { status: 400 },
      );
    await assert.rejects(
      request('/api/v1/tickets', z.unknown()),
      (error) =>
        error instanceof ApiClientError &&
        error.status === 400 &&
        error.fieldErrors.subject?.[0] === 'Required',
    );
    globalThis.fetch = async () => new Response('<html>Proxy error</html>', { status: 502 });
    await assert.rejects(
      request('/api/v1/tickets', z.unknown()),
      (error) => error instanceof ApiClientError && error.code === 'INVALID_RESPONSE',
    );
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    await assert.rejects(
      request('/api/v1/tickets', z.object({ data: z.string() })),
      (error) => error instanceof ApiClientError && error.code === 'INVALID_RESPONSE',
    );
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(
      await request('/api/v1/auth/logout', z.undefined(), { method: 'POST' }),
      undefined,
    );
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async (_path, init) => {
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException('Aborted', 'AbortError');
    };
    await assert.rejects(request('/api/v1/books', z.unknown(), { signal: controller.signal }), {
      name: 'AbortError',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('session replacement preserves live observers, clears private data, and 401s expire all queries', async () => {
  const client = createQueryClient();
  const user = {
    id: 'a',
    email: 'a@example.test',
    displayName: 'Author A',
    role: 'AUTHOR' as const,
    authorId: 'AUTH001',
  };
  client.setQueryData(sessionKey, null);
  const observer = new QueryObserver(client, { queryKey: sessionKey, enabled: false });
  const values: unknown[] = [];
  const unsubscribe = observer.subscribe((value) => values.push(value.data));
  client.setQueryData(['books', 'a'], { private: 'old' });
  await replaceSession(client, user);
  assert.deepEqual(observer.getCurrentResult().data, user);
  assert.equal(client.getQueryData(['books', 'a']), undefined);
  client.setQueryData(['ticket', 'a', 'secret'], { private: 'new' });
  await assert.rejects(
    client.fetchQuery({
      queryKey: ['tickets', 'a'],
      queryFn: () => Promise.reject(new ApiClientError(401, 'UNAUTHENTICATED', 'Sign in.')),
    }),
  );
  assert.equal(client.getQueryData(sessionKey), null);
  assert.equal(client.getQueryData(sessionExpiredKey), true);
  assert.equal(client.getQueryData(['ticket', 'a', 'secret']), undefined);
  await replaceSession(client, { ...user, id: 'b', authorId: 'AUTH002' });
  assert.equal(client.getQueryData(sessionExpiredKey), false);
  assert.ok(values.length >= 3);
  await replaceSession(client, null);
  assert.equal(observer.getCurrentResult().data, null);
  unsubscribe();
  client.clear();
});

test('active polling pauses while unfocused, backs off failures and receives new replies without reload', async () => {
  environmentManager.setIsServer(() => false);
  const timers = new Map<number, { callback: () => void; delay: number; repeat: boolean }>();
  let serial = 0;
  timeoutManager.setTimeoutProvider({
    setTimeout: (callback, delay) => {
      const id = ++serial;
      timers.set(id, { callback: () => callback(), delay, repeat: false });
      return id;
    },
    clearTimeout: (id) => {
      if (id !== undefined) timers.delete(id);
    },
    setInterval: (callback, delay) => {
      const id = ++serial;
      timers.set(id, { callback: () => callback(), delay, repeat: true });
      return id;
    },
    clearInterval: (id) => {
      if (id !== undefined) timers.delete(id);
    },
  });
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const tick = async (delay: number) => {
    for (const timer of [...timers.values()])
      if (timer.repeat && timer.delay === delay) timer.callback();
    await flush();
  };
  const client = createQueryClient();
  client.mount();
  focusManager.setFocused(true);
  let calls = 0,
    fail = false;
  const replies: string[] = [];
  const observer = new QueryObserver(client, {
    queryKey: ['ticket', 'test'],
    queryFn: async () => {
      calls++;
      if (fail) throw new Error('Network unavailable');
      return [...replies];
    },
    ...polling,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await flush();
    assert.equal(calls, 1);
    focusManager.setFocused(false);
    await tick(5000);
    assert.equal(calls, 1);
    focusManager.setFocused(true);
    await flush();
    replies.push('New public reply');
    await tick(5000);
    assert.deepEqual(observer.getCurrentResult().data, ['New public reply']);
    fail = true;
    await tick(5000);
    assert.ok(observer.getCurrentResult().isError);
    const afterFailure = calls;
    await tick(5000);
    assert.equal(calls, afterFailure);
    assert.ok([...timers.values()].some((t) => t.repeat && t.delay === 30000));
    fail = false;
    await tick(30000);
    assert.equal(observer.getCurrentResult().isError, false);
    assert.ok([...timers.values()].some((t) => t.repeat && t.delay === 5000));
    assert.equal(pollDelay(new ApiClientError(404, 'NOT_FOUND', 'Missing'), 1), false);
    assert.equal(pollDelay(new Error('Offline'), 10), 60000);
  } finally {
    unsubscribe();
    client.unmount();
    client.clear();
    timers.clear();
    focusManager.setFocused(undefined);
    environmentManager.setIsServer(() => true);
  }
});
