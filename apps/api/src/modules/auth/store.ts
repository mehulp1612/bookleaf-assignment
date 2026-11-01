import type { CurrentUser } from '@bookleaf/contracts';

export type AuthUser = CurrentUser & { passwordHash: string };
export interface StoredSession {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}
export interface ThrottleBucket {
  key: string;
  limit: number;
}

export interface AuthStore {
  findUser(email: string): Promise<AuthUser | null>;
  findSession(hash: string): Promise<(StoredSession & { user: AuthUser }) | null>;
  replaceSession(session: StoredSession, oldHash: string | null, now: Date): Promise<void>;
  deleteSession(hash: string): Promise<void>;
  // Atomically counts attempts across processes. Returns seconds until a blocked bucket resets.
  consumeAttempts(buckets: ThrottleBucket[], now: Date, windowSeconds: number): Promise<number>;
}
