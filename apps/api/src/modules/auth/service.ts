import { createHash, randomBytes } from 'node:crypto';
import { currentUserSchema } from '@bookleaf/contracts';
import { HttpError } from '../../infrastructure/errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
import type { AuthStore } from './store.js';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const validToken = (token: string | null): token is string =>
  token !== null && /^[a-f0-9]{64}$/.test(token);

export interface AuthOptions {
  store: AuthStore;
  appOrigin: string;
  production: boolean;
  sessionTtlSeconds: number;
  clock?: () => Date;
}

export async function createAuthService(options: AuthOptions) {
  const { store } = options;
  const clock = options.clock ?? (() => new Date());
  // Unknown emails still perform the same expensive password verification.
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  return {
    async throttle(scope: 'ip' | 'email', value: string) {
      return store.consumeAttempts(
        [{ key: `${scope}:${hashToken(value)}`, limit: scope === 'ip' ? 30 : 10 }],
        clock(),
        15 * 60,
      );
    },
    async login(email: string, password: string, oldToken: string | null) {
      const user = await store.findUser(email);
      const matches = await verifyPassword(password, user?.passwordHash ?? dummyHash);
      if (!user || !matches)
        throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid email or password.');
      const principal = currentUserSchema.parse(user);
      const token = randomBytes(32).toString('hex');
      const now = clock();
      const expiresAt = new Date(now.getTime() + options.sessionTtlSeconds * 1000);
      await store.replaceSession(
        { tokenHash: hashToken(token), userId: user.id, expiresAt },
        validToken(oldToken) ? hashToken(oldToken) : null,
        now,
      );
      return { principal, token, expiresAt };
    },
    async resolve(token: string | null) {
      if (!validToken(token)) return null;
      const session = await store.findSession(hashToken(token));
      if (!session) return null;
      if (session.expiresAt.getTime() <= clock().getTime()) {
        await store.deleteSession(session.tokenHash);
        return null;
      }
      return currentUserSchema.parse(session.user);
    },
    async logout(token: string | null) {
      if (validToken(token)) await store.deleteSession(hashToken(token));
    },
  };
}
