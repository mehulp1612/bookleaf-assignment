import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AuthStore } from './store.js';

export function createPrismaAuthStore(client: PrismaClient): AuthStore {
  return {
    findUser: (email) => client.user.findUnique({ where: { email } }),
    findSession: (tokenHash) =>
      client.session.findUnique({ where: { tokenHash }, include: { user: true } }),
    async replaceSession(session, oldHash, now) {
      await client.$transaction(async (tx) => {
        await tx.session.deleteMany({
          where: {
            OR: [{ expiresAt: { lte: now } }, ...(oldHash ? [{ tokenHash: oldHash }] : [])],
          },
        });
        await tx.session.create({ data: session });
      });
    },
    async deleteSession(tokenHash) {
      await client.session.deleteMany({ where: { tokenHash } });
    },
    async consumeAttempts(buckets, now, windowSeconds) {
      return client.$transaction(async (tx) => {
        const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
        let retryAfter = 0;
        // Stable lock order for concurrent login requests using different identities/IPs.
        for (const bucket of [...buckets].sort((a, b) => a.key.localeCompare(b.key))) {
          const [row] = await tx.$queryRaw<{ attempts: number; expiresAt: Date }[]>`
            INSERT INTO "LoginThrottle" ("key", "attempts", "expiresAt")
            VALUES (${bucket.key}, 1, ${expiresAt})
            ON CONFLICT ("key") DO UPDATE SET
              "attempts" = CASE WHEN "LoginThrottle"."expiresAt" <= ${now}
                THEN 1 ELSE LEAST("LoginThrottle"."attempts" + 1, 1000000) END,
              "expiresAt" = CASE WHEN "LoginThrottle"."expiresAt" <= ${now}
                THEN ${expiresAt} ELSE "LoginThrottle"."expiresAt" END
            RETURNING "attempts", "expiresAt"`;
          if (!row) throw new Error('Throttle update returned no row.');
          if (row.attempts > bucket.limit) {
            retryAfter = Math.max(
              retryAfter,
              Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000),
            );
          }
        }
        // Bound retained history, without resetting active buckets.
        await tx.loginThrottle.deleteMany({
          where: { expiresAt: { lt: new Date(now.getTime() - 86400000) } },
        });
        return retryAfter;
      });
    },
  };
}
