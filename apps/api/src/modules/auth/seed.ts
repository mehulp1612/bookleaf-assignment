import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { hashPassword } from './passwords.js';

export const seedAuthorsSchema = z
  .object({
    authors: z
      .array(
        z.object({
          author_id: z.string().min(1),
          name: z.string().min(1),
          email: z.string().trim().toLowerCase().pipe(z.email()),
        }),
      )
      .min(1),
  })
  .superRefine(({ authors }, ctx) => {
    if (
      new Set(authors.map((a) => a.author_id)).size !== authors.length ||
      new Set(authors.map((a) => a.email)).size !== authors.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate seed identities.' });
    }
  });
export const seedCredentialsSchema = z
  .object({
    DEMO_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
    DEMO_ADMIN_PASSWORD: z.string().min(16).max(128),
    DEMO_AUTHOR_PASSWORD: z.string().min(16).max(128),
    DEMO_RESET_PASSWORDS: z.enum(['true', 'false']).default('false'),
  })
  .refine((value) => value.DEMO_ADMIN_PASSWORD !== value.DEMO_AUTHOR_PASSWORD, {
    message: 'Admin and author demo passwords must differ.',
  });

export async function seedIdentity(
  client: PrismaClient,
  rawAuthors: unknown,
  rawCredentials: unknown,
) {
  const { authors } = seedAuthorsSchema.parse(rawAuthors);
  const credentials = seedCredentialsSchema.parse(rawCredentials);
  if (authors.some((author) => author.email === credentials.DEMO_ADMIN_EMAIL)) {
    throw new Error('Admin email must not match an author.');
  }
  const users = await Promise.all([
    ...authors.map(async (author) => ({
      id: `demo-author-${author.author_id}`,
      authorId: author.author_id,
      role: 'AUTHOR' as const,
      email: author.email,
      displayName: author.name,
      passwordHash: await hashPassword(credentials.DEMO_AUTHOR_PASSWORD),
    })),
    hashPassword(credentials.DEMO_ADMIN_PASSWORD).then((passwordHash) => ({
      id: 'demo-admin',
      authorId: null,
      role: 'ADMIN' as const,
      email: credentials.DEMO_ADMIN_EMAIL,
      displayName: 'Demo administrator',
      passwordHash,
    })),
  ]);
  await client.$transaction(
    async (tx) => {
      for (const author of authors) {
        await tx.author.upsert({
          where: { id: author.author_id },
          create: { id: author.author_id },
          update: {},
        });
      }
      for (const user of users) {
        const existing = await tx.user.findUnique({ where: { id: user.id } });
        if (existing && (existing.role !== user.role || existing.authorId !== user.authorId)) {
          throw new Error('Existing identity conflicts with demo seed.');
        }
        const rotate = credentials.DEMO_RESET_PASSWORDS === 'true';
        await tx.user.upsert({
          where: { id: user.id },
          create: user,
          update: {
            email: user.email,
            displayName: user.displayName,
            ...(rotate ? { passwordHash: user.passwordHash } : {}),
          },
        });
        if (rotate) await tx.session.deleteMany({ where: { userId: user.id } });
      }
    },
    { timeout: 15000 },
  );
  return { authors: authors.length, users: users.length };
}
