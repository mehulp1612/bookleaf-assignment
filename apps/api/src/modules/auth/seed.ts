import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
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

export async function prepareIdentitySeed(rawAuthors: unknown, rawCredentials: unknown) {
  const { authors } = seedAuthorsSchema.parse(rawAuthors);
  const credentials = seedCredentialsSchema.parse(rawCredentials);
  if (authors.some((author) => author.email === credentials.DEMO_ADMIN_EMAIL)) {
    throw new Error('Admin email must not match an author.');
  }
  // Bound scrypt memory on small deployment instances; each user retains a fresh salt.
  const users: {
    id: string;
    authorId: string | null;
    role: 'AUTHOR' | 'ADMIN';
    email: string;
    displayName: string;
    passwordHash: string;
  }[] = [];
  for (const author of authors) {
    users.push({
      id: `demo-author-${author.author_id}`,
      authorId: author.author_id,
      role: 'AUTHOR' as const,
      email: author.email,
      displayName: author.name,
      passwordHash: await hashPassword(credentials.DEMO_AUTHOR_PASSWORD),
    });
  }
  users.push({
    id: 'demo-admin',
    authorId: null,
    role: 'ADMIN' as const,
    email: credentials.DEMO_ADMIN_EMAIL,
    displayName: 'Demo administrator',
    passwordHash: await hashPassword(credentials.DEMO_ADMIN_PASSWORD),
  });
  return { authors, users, rotate: credentials.DEMO_RESET_PASSWORDS === 'true' };
}

export async function writeIdentitySeed(
  tx: Prisma.TransactionClient,
  { authors, users, rotate }: Awaited<ReturnType<typeof prepareIdentitySeed>>,
) {
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
  return { authors: authors.length, users: users.length };
}

export async function seedIdentity(
  client: PrismaClient,
  rawAuthors: unknown,
  rawCredentials: unknown,
) {
  const prepared = await prepareIdentitySeed(rawAuthors, rawCredentials);
  return client.$transaction((tx) => writeIdentitySeed(tx, prepared), { timeout: 15000 });
}
