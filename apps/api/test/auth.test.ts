import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { requireRole } from '../src/modules/auth/http.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/passwords.js';
import { hashToken } from '../src/modules/auth/service.js';
import type {
  AuthStore,
  AuthUser,
  StoredSession,
  ThrottleBucket,
} from '../src/modules/auth/store.js';

// Generated at runtime, never a usable demo credential committed to the repository.
const password = randomBytes(24).toString('base64url');
const passwordHash = hashPassword(password);
const origin = 'http://localhost:5173';
const mutationHeaders = { origin, 'x-bookleaf-request': '1' };

class MemoryAuthStore implements AuthStore {
  users = new Map<string, AuthUser>();
  sessions = new Map<string, StoredSession>();
  buckets = new Map<string, { attempts: number; expiresAt: number }>();
  async findUser(email: string) {
    return this.users.get(email) ?? null;
  }
  async findSession(hash: string) {
    const session = this.sessions.get(hash);
    const user = [...this.users.values()].find((value) => value.id === session?.userId);
    return session && user ? { ...session, user } : null;
  }
  async replaceSession(session: StoredSession, oldHash: string | null, now: Date) {
    for (const [hash, value] of this.sessions) {
      if (value.expiresAt <= now || hash === oldHash) this.sessions.delete(hash);
    }
    this.sessions.set(session.tokenHash, session);
  }
  async deleteSession(hash: string) {
    this.sessions.delete(hash);
  }
  async consumeAttempts(buckets: ThrottleBucket[], now: Date, windowSeconds: number) {
    let retry = 0;
    for (const bucket of buckets) {
      let entry = this.buckets.get(bucket.key);
      if (!entry || entry.expiresAt <= now.getTime()) {
        entry = { attempts: 0, expiresAt: now.getTime() + windowSeconds * 1000 };
        this.buckets.set(bucket.key, entry);
      }
      entry.attempts++;
      if (entry.attempts > bucket.limit)
        retry = Math.max(retry, Math.ceil((entry.expiresAt - now.getTime()) / 1000));
    }
    return retry;
  }
}

async function fixture(production = false) {
  let time = Date.parse('2026-11-01T12:00:00Z');
  const store = new MemoryAuthStore();
  store.users.set('author@example.test', {
    id: 'user-author',
    email: 'author@example.test',
    displayName: 'Demo author',
    role: 'AUTHOR',
    authorId: 'AUTH001',
    passwordHash: await passwordHash,
  });
  store.users.set('admin@example.test', {
    id: 'user-admin',
    email: 'admin@example.test',
    displayName: 'Demo admin',
    role: 'ADMIN',
    authorId: null,
    passwordHash: await passwordHash,
  });
  const app = await buildApp({
    logLevel: 'silent',
    database: { check: async () => {}, close: async () => {} },
    auth: {
      store,
      production,
      appOrigin: production ? 'https://bookleaf.example.test' : origin,
      sessionTtlSeconds: 60,
      clock: () => new Date(time),
    },
  });
  app.get('/api/v1/admin-test', { preHandler: requireRole('ADMIN') }, async () => ({ ok: true }));
  app.post('/api/v1/mutation-test', async () => ({ ok: true }));
  const login = (email = 'author@example.test', extra: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        ...mutationHeaders,
        ...(production ? { origin: 'https://bookleaf.example.test' } : {}),
        ...extra,
      },
      payload: { email, password },
    });
  return {
    app,
    store,
    login,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

function cookie(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  assert.equal(typeof header, 'string');
  return String(header).split(';')[0]!;
}

test('scrypt uses different salts, verifies full passwords, and rejects malformed hashes', async () => {
  const first = await passwordHash;
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(`${password} `, first), false);
  assert.equal(await verifyPassword(password, 'scrypt$999999999$8$3$bad$bad'), false);
});

test('login, me, and logout use a hashed session and never expose credentials in JSON', async () => {
  const f = await fixture();
  try {
    const response = await f.login(' AUTHOR@EXAMPLE.TEST ');
    assert.equal(response.statusCode, 200);
    const sessionCookie = cookie(response);
    assert.match(String(response.headers['set-cookie']), /HttpOnly; SameSite=Lax; Max-Age=60/);
    assert.doesNotMatch(String(response.headers['set-cookie']), /Secure|Domain=/);
    const token = sessionCookie.split('=')[1]!;
    assert.ok(f.store.sessions.has(hashToken(token)));
    assert.equal(f.store.sessions.has(token), false);
    assert.equal(response.json().data.authorId, 'AUTH001');
    for (const secret of [token, password, await passwordHash, 'passwordHash'])
      assert.equal(response.body.includes(secret), false);
    const me = await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: sessionCookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.headers['cache-control'], 'no-store');
    assert.deepEqual(me.json(), response.json());
    const logout = await f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { ...mutationHeaders, cookie: sessionCookie },
    });
    assert.equal(logout.statusCode, 204);
    assert.equal(logout.body, '');
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    assert.equal(f.store.sessions.size, 0);
    assert.equal(
      (await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: sessionCookie } }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: { ...mutationHeaders, cookie: sessionCookie },
        })
      ).statusCode,
      401,
    );
  } finally {
    await f.app.close();
  }
});

test('wrong password and unknown account return the same safe failure', async () => {
  const f = await fixture();
  try {
    const results = [];
    for (const email of ['author@example.test', 'missing@example.test']) {
      const result = await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: mutationHeaders,
        payload: { email, password: 'incorrect' },
      });
      assert.equal(result.statusCode, 401);
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.headers['set-cookie'], undefined);
      results.push(result.json().error.message);
    }
    assert.equal(results[0], results[1]);
    assert.equal(f.store.sessions.size, 0);
    const invalid = await f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: mutationHeaders,
      payload: { email: 'author@example.test', password, role: 'ADMIN' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.includes(password), false);
  } finally {
    await f.app.close();
  }
});

test('expiry is absolute and login rotates the supplied session', async () => {
  const f = await fixture();
  try {
    const oldCookie = cookie(await f.login());
    const newCookie = cookie(await f.login('author@example.test', { cookie: oldCookie }));
    assert.notEqual(oldCookie, newCookie);
    assert.equal(f.store.sessions.size, 1);
    assert.equal(
      (await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: oldCookie } })).statusCode,
      401,
    );
    f.advance(59000);
    assert.equal(
      (await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: newCookie } })).statusCode,
      200,
    );
    f.advance(1000);
    assert.equal(
      (await f.app.inject({ url: '/api/v1/auth/me', headers: { cookie: newCookie } })).statusCode,
      401,
    );
    assert.equal(f.store.sessions.size, 0);
  } finally {
    await f.app.close();
  }
});

test('server guards reject missing/forged/ambiguous cookies and enforce current database role', async () => {
  const f = await fixture();
  try {
    for (const value of ['', 'bookleaf_session=invalid', `bookleaf_session=${'a'.repeat(64)}`]) {
      assert.equal(
        (await f.app.inject({ url: '/api/v1/admin-test', headers: { cookie: value } })).statusCode,
        401,
      );
    }
    const authorCookie = cookie(await f.login());
    assert.equal(
      (await f.app.inject({ url: '/api/v1/admin-test', headers: { cookie: authorCookie } }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          url: '/api/v1/auth/me',
          headers: { cookie: `${authorCookie}; ${authorCookie}` },
        })
      ).statusCode,
      401,
    );
    const adminCookie = cookie(await f.login('admin@example.test'));
    assert.equal(
      (await f.app.inject({ url: '/api/v1/admin-test', headers: { cookie: adminCookie } }))
        .statusCode,
      200,
    );
    const admin = f.store.users.get('admin@example.test')!;
    f.store.users.set(admin.email, { ...admin, role: 'AUTHOR', authorId: 'AUTH002' });
    assert.equal(
      (await f.app.inject({ url: '/api/v1/admin-test', headers: { cookie: adminCookie } }))
        .statusCode,
      403,
    );
  } finally {
    await f.app.close();
  }
});

test('CSRF protection applies to login, logout, and future mutations with valid cookies', async () => {
  const f = await fixture();
  try {
    const sessionCookie = cookie(await f.login());
    for (const headers of [
      {},
      { origin },
      { 'x-bookleaf-request': '1' },
      { ...mutationHeaders, origin: 'null' },
      { ...mutationHeaders, origin: 'https://evil.example.test' },
      { ...mutationHeaders, 'sec-fetch-site': 'cross-site' },
    ]) {
      for (const url of ['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/mutation-test']) {
        const response = await f.app.inject({
          method: 'POST',
          url,
          headers: { ...headers, cookie: sessionCookie },
          payload: { email: 'author@example.test', password },
        });
        assert.equal(response.statusCode, 403);
        assert.equal(response.headers['access-control-allow-origin'], undefined);
      }
    }
    assert.equal(f.store.sessions.size, 1);
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/v1/mutation-test',
          headers: { ...mutationHeaders, cookie: sessionCookie },
        })
      ).statusCode,
      200,
    );
  } finally {
    await f.app.close();
  }
});

test('production cookies use the host prefix, secure flag, and matching deletion attributes', async () => {
  const f = await fixture(true);
  try {
    const response = await f.login();
    assert.match(
      String(response.headers['set-cookie']),
      /^__Host-bookleaf_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Secure;/,
    );
    assert.doesNotMatch(String(response.headers['set-cookie']), /Domain=/);
    const logout = await f.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        origin: 'https://bookleaf.example.test',
        'x-bookleaf-request': '1',
        cookie: cookie(response),
      },
    });
    assert.equal(logout.statusCode, 204);
    assert.match(
      String(logout.headers['set-cookie']),
      /^__Host-bookleaf_session=; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=0/,
    );
  } finally {
    await f.app.close();
  }
});

test('account throttling handles unknown emails, normalization, and window reset', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 10; i++)
      assert.equal((await f.login(' UNKNOWN@EXAMPLE.TEST ')).statusCode, 401);
    const blocked = await f.login('unknown@example.test');
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers['retry-after'], '900');
    assert.equal(blocked.headers['set-cookie'], undefined);
    assert.equal(
      [...f.store.buckets.keys()].some((key) => key.includes('@')),
      false,
    );
    f.advance(900000);
    assert.equal((await f.login('unknown@example.test')).statusCode, 401);
  } finally {
    await f.app.close();
  }
});

test('IP throttling also counts malformed bodies and ignores spoofed forwarded IPs', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 30; i++) {
      assert.equal(
        (
          await f.app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            headers: { ...mutationHeaders, 'x-forwarded-for': `192.0.2.${i}` },
            payload: {},
          })
        ).statusCode,
        400,
      );
    }
    assert.equal((await f.login()).statusCode, 429);
  } finally {
    await f.app.close();
  }
});

test('storage failure fails closed without issuing a session or leaking error details', async () => {
  const f = await fixture();
  try {
    f.store.replaceSession = async () => {
      throw new Error('private-database-detail');
    };
    const response = await f.login();
    assert.equal(response.statusCode, 500);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.body.includes('private-database-detail'), false);
  } finally {
    await f.app.close();
  }
});

test('business routes fail closed if authentication wiring is omitted', async () => {
  const app = await buildApp({
    logLevel: 'silent',
    database: { check: async () => {}, close: async () => {} },
  });
  app.get('/api/v1/private-test', async () => ({ secret: true }));
  try {
    assert.equal((await app.inject('/api/v1/private-test')).statusCode, 503);
  } finally {
    await app.close();
  }
});
