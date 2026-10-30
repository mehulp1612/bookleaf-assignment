import { z } from 'zod';

export const API_PREFIX = '/api/v1';
export const roleSchema = z.enum(['AUTHOR', 'ADMIN']);
export const ticketStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
export const prioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const categorySchema = z.enum([
  'ROYALTY_PAYMENTS',
  'ISBN_METADATA',
  'PRINTING_QUALITY',
  'DISTRIBUTION_AVAILABILITY',
  'BOOK_STATUS_PRODUCTION',
  'GENERAL_INQUIRY',
]);
export const aiTaskStateSchema = z.enum([
  'NOT_REQUESTED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);
export const classificationSourceSchema = z.enum(['DEFAULT', 'AI', 'MANUAL']);
export const categoryLabels: Record<z.infer<typeof categorySchema>, string> = {
  ROYALTY_PAYMENTS: 'Royalty & Payments',
  ISBN_METADATA: 'ISBN & Metadata Issues',
  PRINTING_QUALITY: 'Printing & Quality',
  DISTRIBUTION_AVAILABILITY: 'Distribution & Availability',
  BOOK_STATUS_PRODUCTION: 'Book Status & Production Updates',
  GENERAL_INQUIRY: 'General Inquiry',
};
export const statusLabels: Record<z.infer<typeof ticketStatusSchema>, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
export const priorityLabels: Record<z.infer<typeof prioritySchema>, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};
export const allowedStatusTransitions: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
};

export const idSchema = z.string().min(1).max(128);
export const dateSchema = z.iso.date();
export const timestampSchema = z.iso.datetime();
export const moneyPaiseSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revisionSchema = countSchema;
const subjectSchema = z.string().trim().min(1).max(200);
const bodySchema = z.string().trim().min(1).max(10_000);

export const currentUserSchema = z
  .object({
    id: idSchema,
    email: z.email(),
    role: roleSchema,
    displayName: z.string().min(1),
    authorId: idSchema.nullable(),
  })
  .refine((user) => user.role !== 'AUTHOR' || user.authorId !== null, {
    message: 'An author user must have an author profile.',
    path: ['authorId'],
  });
export const personReferenceSchema = z.object({ id: idSchema, displayName: z.string().min(1) });
export const bookReferenceSchema = z.object({ id: idSchema, title: z.string().min(1) });
export const bookSchema = z.object({
  id: idSchema,
  authorId: idSchema,
  title: z.string().min(1),
  isbn: z.string().min(1),
  genre: z.string(),
  publicationDate: dateSchema.nullable(),
  status: z.string().min(1),
  mrpPaise: moneyPaiseSchema.nullable(),
  authorRoyaltyPerCopyPaise: moneyPaiseSchema.nullable(),
  totalCopiesSold: countSchema,
  totalRoyaltyEarnedPaise: moneyPaiseSchema,
  royaltyPaidPaise: moneyPaiseSchema,
  royaltyPendingPaise: moneyPaiseSchema,
  lastRoyaltyPayoutDate: dateSchema.nullable(),
  printPartner: z.string().nullable(),
  availableOn: z.array(z.string().min(1)),
});
export const publicReplySchema = z.object({
  id: idSchema,
  body: bodySchema,
  senderDisplayName: z.string().min(1),
  createdAt: timestampSchema,
});
export const privateNoteSchema = z.object({
  id: idSchema,
  body: bodySchema,
  creator: personReferenceSchema,
  createdAt: timestampSchema,
});
export const ticketEventSchema = z.object({
  id: idSchema,
  actor: personReferenceSchema.nullable(),
  type: z.enum(['STATUS_CHANGED', 'ASSIGNMENT_CHANGED', 'CATEGORY_CHANGED', 'PRIORITY_CHANGED']),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  createdAt: timestampSchema,
});
export const authorTicketSummarySchema = z.object({
  id: idSchema,
  book: bookReferenceSchema.nullable(),
  subject: subjectSchema,
  status: ticketStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
// Output schemas strip unknown fields. Parse through the author schema at the API boundary.
export const authorTicketDetailSchema = authorTicketSummarySchema.extend({
  description: bodySchema,
  replies: z.array(publicReplySchema),
});
export const adminTicketSummarySchema = authorTicketSummarySchema.extend({
  author: personReferenceSchema,
  category: categorySchema.nullable(),
  priority: prioritySchema,
  classificationState: aiTaskStateSchema,
  categorySource: classificationSourceSchema,
  prioritySource: classificationSourceSchema,
  assignee: personReferenceSchema.nullable(),
  revision: revisionSchema,
});
export const adminTicketDetailSchema = adminTicketSummarySchema.extend({
  description: bodySchema,
  replies: z.array(publicReplySchema),
  notes: z.array(privateNoteSchema),
  events: z.array(ticketEventSchema),
  draftState: aiTaskStateSchema,
});

const draftMetadata = z.object({
  id: idSchema,
  contextRevision: revisionSchema,
  stale: z.boolean(),
  createdAt: timestampSchema,
});
export const aiDraftSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NOT_REQUESTED') }),
  draftMetadata.extend({ state: z.literal('QUEUED') }),
  draftMetadata.extend({ state: z.literal('RUNNING') }),
  draftMetadata.extend({ state: z.literal('SUCCEEDED'), text: bodySchema }),
  draftMetadata.extend({ state: z.literal('FAILED'), failureReason: z.string().min(1).max(500) }),
]);
export const classificationResultSchema = z.strictObject({
  category: categorySchema,
  priority: prioritySchema,
  rationale: z.string().trim().min(1).max(1000),
});
export const draftedResponseSchema = z.strictObject({
  text: bodySchema,
  policySections: z.array(z.string().min(1)).max(20),
});

export const paginationSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  total: countSchema,
});
export const resourceResponseSchema = <T extends z.ZodType>(resource: T) =>
  z.object({ data: resource });
export const listResponseSchema = <T extends z.ZodType>(resource: T) =>
  z.object({
    data: z.array(resource),
    meta: paginationMetaSchema,
  });
export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'REQUEST_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
]);
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    requestId: z.string().min(1),
  }),
});
export const healthResponseSchema = resourceResponseSchema(z.object({ status: z.literal('ok') }));

export const loginRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(1024),
});
export const createTicketRequestSchema = z.strictObject({
  bookId: idSchema.nullable(),
  subject: subjectSchema,
  description: bodySchema,
});
export const updateTicketRequestSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    status: ticketStatusSchema.optional(),
    category: categorySchema.optional(),
    priority: prioritySchema.optional(),
    assignmentAction: z.enum(['SELF', 'UNASSIGN']).optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'), {
    message: 'Supply at least one ticket change.',
  });
export const createReplyRequestSchema = z.strictObject({
  body: bodySchema,
  expectedRevision: revisionSchema,
});
export const createNoteRequestSchema = z.strictObject({ body: bodySchema });
export const draftRequestSchema = z.strictObject({ regenerate: z.boolean().default(false) });
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const idParamsSchema = z.strictObject({ id: idSchema });
export const bookListQuerySchema = paginationSchema.extend({ authorId: idSchema.optional() });
const dateFilters = {
  createdFrom: dateSchema.optional(),
  createdTo: dateSchema.optional(),
};
const validDateRange = (value: {
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}) => !value.createdFrom || !value.createdTo || value.createdFrom <= value.createdTo;
export const authorTicketQuerySchema = paginationSchema
  .extend({
    status: ticketStatusSchema.optional(),
    ...dateFilters,
    sort: z.enum(['oldest', 'newest']).default('newest'),
  })
  .refine(validDateRange, {
    message: 'createdFrom must not follow createdTo.',
    path: ['createdTo'],
  });
export const adminTicketQuerySchema = paginationSchema
  .extend({
    status: ticketStatusSchema.optional(),
    category: categorySchema.optional(),
    priority: prioritySchema.optional(),
    ...dateFilters,
    sort: z.enum(['queue', 'oldest', 'newest']).default('queue'),
  })
  .refine(validDateRange, {
    message: 'createdFrom must not follow createdTo.',
    path: ['createdTo'],
  });
export const createdTicketSchema = authorTicketDetailSchema.extend({
  classificationState: aiTaskStateSchema,
});
export const classificationJobSchema = z.object({ ticketId: idSchema, state: aiTaskStateSchema });

// Route metadata describes future endpoints; it does not register business handlers.
export const endpoints = {
  login: {
    method: 'POST',
    path: '/auth/login',
    access: 'PUBLIC',
    body: loginRequestSchema,
    response: resourceResponseSchema(currentUserSchema),
  },
  logout: {
    method: 'POST',
    path: '/auth/logout',
    access: 'AUTHENTICATED',
    response: z.undefined(),
  },
  me: {
    method: 'GET',
    path: '/auth/me',
    access: 'AUTHENTICATED',
    response: resourceResponseSchema(currentUserSchema),
  },
  books: {
    method: 'GET',
    path: '/books',
    access: 'AUTHENTICATED',
    query: bookListQuerySchema,
    response: listResponseSchema(bookSchema),
  },
  book: {
    method: 'GET',
    path: '/books/:id',
    access: 'AUTHENTICATED',
    response: resourceResponseSchema(bookSchema),
  },
  createTicket: {
    method: 'POST',
    path: '/tickets',
    access: 'AUTHOR',
    body: createTicketRequestSchema,
    response: resourceResponseSchema(createdTicketSchema),
  },
  authorTickets: {
    method: 'GET',
    path: '/tickets',
    access: 'AUTHOR',
    query: authorTicketQuerySchema,
    response: listResponseSchema(authorTicketSummarySchema),
  },
  adminTickets: {
    method: 'GET',
    path: '/tickets',
    access: 'ADMIN',
    query: adminTicketQuerySchema,
    response: listResponseSchema(adminTicketSummarySchema),
  },
  authorTicket: {
    method: 'GET',
    path: '/tickets/:id',
    access: 'AUTHOR',
    response: resourceResponseSchema(authorTicketDetailSchema),
  },
  adminTicket: {
    method: 'GET',
    path: '/tickets/:id',
    access: 'ADMIN',
    response: resourceResponseSchema(adminTicketDetailSchema),
  },
  updateTicket: {
    method: 'PATCH',
    path: '/tickets/:id',
    access: 'ADMIN',
    body: updateTicketRequestSchema,
    response: resourceResponseSchema(adminTicketDetailSchema),
  },
  reply: {
    method: 'POST',
    path: '/tickets/:id/replies',
    access: 'ADMIN',
    body: createReplyRequestSchema,
    response: resourceResponseSchema(publicReplySchema),
  },
  note: {
    method: 'POST',
    path: '/tickets/:id/notes',
    access: 'ADMIN',
    body: createNoteRequestSchema,
    response: resourceResponseSchema(privateNoteSchema),
  },
  requestDraft: {
    method: 'POST',
    path: '/tickets/:id/ai-drafts',
    access: 'ADMIN',
    body: draftRequestSchema,
    response: resourceResponseSchema(aiDraftSchema),
  },
  latestDraft: {
    method: 'GET',
    path: '/tickets/:id/ai-drafts/latest',
    access: 'ADMIN',
    response: resourceResponseSchema(aiDraftSchema),
  },
  retryClassification: {
    method: 'POST',
    path: '/tickets/:id/ai-classification',
    access: 'ADMIN',
    response: resourceResponseSchema(classificationJobSchema),
  },
} as const;

export type Role = z.infer<typeof roleSchema>;
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type Category = z.infer<typeof categorySchema>;
export type AiTaskState = z.infer<typeof aiTaskStateSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type Book = z.infer<typeof bookSchema>;
export type AuthorTicketSummary = z.infer<typeof authorTicketSummarySchema>;
export type AuthorTicketDetail = z.infer<typeof authorTicketDetailSchema>;
export type AdminTicketSummary = z.infer<typeof adminTicketSummarySchema>;
export type AdminTicketDetail = z.infer<typeof adminTicketDetailSchema>;
export type PublicReply = z.infer<typeof publicReplySchema>;
export type PrivateNote = z.infer<typeof privateNoteSchema>;
export type AiDraft = z.infer<typeof aiDraftSchema>;
export type ApiError = z.infer<typeof errorResponseSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type CreateTicketRequest = z.infer<typeof createTicketRequestSchema>;
export type UpdateTicketRequest = z.infer<typeof updateTicketRequestSchema>;
export type ClassificationResult = z.infer<typeof classificationResultSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateReplyRequest = z.infer<typeof createReplyRequestSchema>;
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;
export type DraftRequest = z.infer<typeof draftRequestSchema>;
export type AdminTicketQuery = z.infer<typeof adminTicketQuerySchema>;
export type AuthorTicketQuery = z.infer<typeof authorTicketQuerySchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
export type ResourceResponse<T> = { data: T };
export type ListResponse<T> = { data: T[]; meta: PaginationMeta };
