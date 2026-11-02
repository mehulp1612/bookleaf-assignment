import {
  adminTicketDetailSchema,
  adminTicketSummarySchema,
  authorTicketDetailSchema,
  authorTicketSummarySchema,
  privateNoteSchema,
  publicReplySchema,
  type CurrentUser,
} from '@bookleaf/contracts';
import type { Prisma, TicketReply, TicketNote } from '../../generated/prisma/client.js';

const person = { id: true, displayName: true } as const;
export const summaryInclude = {
  book: { select: { id: true, title: true } },
  author: { select: { id: true, name: true, user: { select: person } } },
  assignee: { select: person },
} satisfies Prisma.TicketInclude;
export const detailInclude = {
  ...summaryInclude,
  jobs: {
    where: { task: 'DRAFT' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { id: true, state: true },
  },
  replies: {
    include: { sender: { select: person } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  notes: {
    include: { creator: { select: person } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  events: {
    include: { actor: { select: person } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.TicketInclude;
type Summary = Prisma.TicketGetPayload<{ include: typeof summaryInclude }>;
type Detail = Prisma.TicketGetPayload<{ include: typeof detailInclude }>;
export function replyDto(row: TicketReply & { sender: { displayName: string } }) {
  return publicReplySchema.parse({
    id: row.id,
    body: row.body,
    senderDisplayName: row.sender.displayName,
    createdAt: row.createdAt.toISOString(),
  });
}
export function noteDto(row: TicketNote & { creator: { id: string; displayName: string } }) {
  return privateNoteSchema.parse({
    id: row.id,
    body: row.body,
    creator: row.creator,
    createdAt: row.createdAt.toISOString(),
  });
}
function common(row: Summary) {
  return {
    id: row.id,
    book: row.book,
    subject: row.subject,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function admin(row: Summary) {
  return {
    ...common(row),
    author: {
      id: row.authorId,
      displayName: row.author.name ?? row.author.user?.displayName ?? 'Author',
    },
    category: row.category,
    priority: row.priority,
    classificationState: row.classificationState,
    categorySource: row.categorySource,
    prioritySource: row.prioritySource,
    assignee: row.assignee,
    revision: row.revision,
  };
}
export function summaryDto(row: Summary, user: CurrentUser) {
  return user.role === 'ADMIN'
    ? adminTicketSummarySchema.parse(admin(row))
    : authorTicketSummarySchema.parse(common(row));
}
export function detailDto(row: Detail, user: CurrentUser) {
  const publicFields = {
    ...common(row),
    description: row.description,
    replies: row.replies.map(replyDto),
  };
  if (user.role === 'AUTHOR') return authorTicketDetailSchema.parse(publicFields);
  return adminTicketDetailSchema.parse({
    ...publicFields,
    ...admin(row),
    notes: row.notes.map(noteDto),
    events: row.events.map((e) => ({
      id: e.id,
      actor: e.actor,
      type: e.type,
      oldValue: e.oldValue,
      newValue: e.newValue,
      createdAt: e.createdAt.toISOString(),
    })),
    draftState: row.jobs.find((job) => job.id === row.draftJobId)?.state ?? 'NOT_REQUESTED',
  });
}
