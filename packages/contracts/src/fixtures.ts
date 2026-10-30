import {
  adminTicketDetailSchema,
  authorTicketDetailSchema,
  bookSchema,
  aiDraftSchema,
  currentUserSchema,
} from './index.js';

// Synthetic tickets and users are development fixtures, not seeded application records.
export const publishedBookFixture = bookSchema.parse({
  id: 'BK001',
  authorId: 'AUTH001',
  title: 'Whispers of the Ganges',
  isbn: '978-93-5XXXX-01-1',
  genre: 'Literary Fiction',
  publicationDate: '2023-06-20',
  status: 'Published & Live',
  mrpPaise: 39900,
  authorRoyaltyPerCopyPaise: 3500,
  totalCopiesSold: 342,
  totalRoyaltyEarnedPaise: 1197000,
  royaltyPaidPaise: 840000,
  royaltyPendingPaise: 357000,
  lastRoyaltyPayoutDate: '2025-10-15',
  printPartner: 'In-House',
  availableOn: ['Amazon India', 'Flipkart', 'BookLeaf Store'],
});
export const productionBookFixture = bookSchema.parse({
  id: 'BK013',
  authorId: 'AUTH007',
  title: 'Midnight in Mysore',
  isbn: '978-93-5XXXX-13-4',
  genre: 'Thriller',
  publicationDate: null,
  status: 'In Production - Cover Design',
  mrpPaise: null,
  authorRoyaltyPerCopyPaise: null,
  totalCopiesSold: 0,
  totalRoyaltyEarnedPaise: 0,
  royaltyPaidPaise: 0,
  royaltyPendingPaise: 0,
  lastRoyaltyPayoutDate: null,
  printPartner: null,
  availableOn: [],
});
export const authorUserFixture = currentUserSchema.parse({
  id: 'fixture-author',
  email: 'priya.sharma@email.com',
  role: 'AUTHOR',
  displayName: 'Priya Sharma',
  authorId: 'AUTH001',
});
export const adminUserFixture = currentUserSchema.parse({
  id: 'fixture-admin',
  email: 'admin@example.test',
  role: 'ADMIN',
  displayName: 'Support team',
  authorId: null,
});
export const authorTicketFixture = authorTicketDetailSchema.parse({
  id: 'fixture-ticket',
  book: { id: 'BK001', title: 'Whispers of the Ganges' },
  subject: 'Please explain my pending royalty',
  description: 'How does the quarterly payout work?',
  status: 'OPEN',
  createdAt: '2026-10-30T10:00:00Z',
  updatedAt: '2026-10-30T10:00:00Z',
  replies: [],
});
export const adminTicketFixture = adminTicketDetailSchema.parse({
  ...authorTicketFixture,
  author: { id: 'AUTH001', displayName: 'Priya Sharma' },
  category: null,
  priority: 'MEDIUM',
  classificationState: 'QUEUED',
  categorySource: 'DEFAULT',
  prioritySource: 'DEFAULT',
  assignee: null,
  revision: 0,
  notes: [
    {
      id: 'fixture-note',
      body: 'Private investigation note.',
      creator: { id: 'fixture-admin', displayName: 'Support team' },
      createdAt: '2026-10-30T10:00:00Z',
    },
  ],
  events: [],
  draftState: 'NOT_REQUESTED',
});
export const pendingDraftFixture = aiDraftSchema.parse({
  id: 'fixture-draft',
  state: 'QUEUED',
  contextRevision: 0,
  stale: false,
  createdAt: '2026-10-30T10:00:00Z',
});
export const failedDraftFixture = aiDraftSchema.parse({
  id: 'fixture-draft-failed',
  state: 'FAILED',
  contextRevision: 0,
  stale: false,
  createdAt: '2026-10-30T10:00:00Z',
  failureReason: 'AI is unavailable. You can write a response manually.',
});
export const failedClassificationTicketFixture = adminTicketDetailSchema.parse({
  ...adminTicketFixture,
  classificationState: 'FAILED',
});
