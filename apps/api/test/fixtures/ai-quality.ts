import { publishedBookFixture, productionBookFixture } from '@bookleaf/contracts/fixtures';
import type { AiContext, Classification, Draft } from '../../src/modules/ai/types.js';

export const baseContext: AiContext = {
  ticketId: 'evaluation-ticket',
  authorId: 'AUTH001',
  contextRevision: 0,
  subject: 'Royalty payout',
  description: 'I have not received royalties for six months. Please help.',
  category: 'ROYALTY_PAYMENTS',
  book: publishedBookFixture,
  account: null,
  publicReplies: [],
};
export const qualityCases: {
  name: string;
  context: AiContext;
  classification: Classification;
  draft: Draft;
}[] = [
  {
    name: 'royalty snapshot does not prove overdue',
    context: baseContext,
    classification: {
      category: 'ROYALTY_PAYMENTS',
      priority: 'HIGH',
      rationale: 'Author reports prolonged nonpayment; staff should verify the ledger.',
    },
    draft: {
      text: 'I understand your concern about royalties. The catalog snapshot shows INR 3,570 pending; it does not establish when payment is due. Royalties are calculated quarterly and paid within 45 days of quarter end, subject to the INR 1,000 threshold. Please ask the support team to verify the payout ledger and confirm the applicable payment date.',
      policyReferences: ['royalties'],
      factReferences: ['book.royaltyPendingINR'],
    },
  },
  {
    name: 'ISBN mismatch',
    context: {
      ...baseContext,
      subject: 'Wrong ISBN',
      description: 'The ISBN on Amazon differs from my physical copy.',
      category: 'ISBN_METADATA',
    },
    classification: {
      category: 'ISBN_METADATA',
      priority: 'HIGH',
      rationale: 'Reported ISBN errors require high-priority production review.',
    },
    draft: {
      text: 'I am sorry about the reported ISBN mismatch. ISBN errors receive high priority. Please share the listing and the ISBN on your physical copy so the support team can request production review.',
      policyReferences: ['isbn'],
      factReferences: [],
    },
  },
  {
    name: 'verified print defects only',
    context: {
      ...baseContext,
      subject: 'Print quality',
      description: 'The pages in my author copies are misaligned.',
      category: 'PRINTING_QUALITY',
    },
    classification: {
      category: 'PRINTING_QUALITY',
      priority: 'MEDIUM',
      rationale: 'Reported print defects require verification.',
    },
    draft: {
      text: 'I am sorry your copies have misaligned pages. Verified defects qualify for a free reprint; the standard print turnaround is 5-7 business days from order confirmation. Please ask support how to share photos for verification.',
      policyReferences: ['printing'],
      factReferences: [],
    },
  },
  {
    name: 'stock sync is a possibility not diagnosis',
    context: {
      ...baseContext,
      subject: 'Amazon unavailable',
      description: 'My book is showing Currently Unavailable on Amazon.',
      category: 'DISTRIBUTION_AVAILABILITY',
    },
    classification: {
      category: 'DISTRIBUTION_AVAILABILITY',
      priority: 'MEDIUM',
      rationale: 'The author reports an unavailable listing.',
    },
    draft: {
      text: 'I understand the concern about availability. Stock sync issues are a common cause, but this listing has not been checked. The policy allows the team to trigger a re-sync within 24-48 hours. Please share the listing so support can investigate and request a re-sync if appropriate.',
      policyReferences: ['distribution'],
      factReferences: [],
    },
  },
  {
    name: 'production nulls and no invented deadline',
    context: {
      ...baseContext,
      authorId: 'AUTH007',
      book: productionBookFixture,
      subject: 'Production update',
      description: 'When will my book be ready?',
      category: 'BOOK_STATUS_PRODUCTION',
    },
    classification: {
      category: 'BOOK_STATUS_PRODUCTION',
      priority: 'MEDIUM',
      rationale: 'The author asks for a production update.',
    },
    draft: {
      text: 'I understand you would like an update. The catalog status is In Production - Cover Design. There is no confirmed completion date or delay reason in this snapshot. Please ask support to confirm the current stage and a realistic timeline.',
      policyReferences: ['production'],
      factReferences: ['book.status'],
    },
  },
  {
    name: 'general account inquiry',
    context: {
      ...baseContext,
      book: null,
      subject: 'Publishing packages',
      description: 'What publishing packages are available?',
      category: 'GENERAL_INQUIRY',
    },
    classification: {
      category: 'GENERAL_INQUIRY',
      priority: 'LOW',
      rationale: 'Routine request for package information.',
    },
    draft: {
      text: 'Thank you for considering publishing with BookLeaf. Standard Free has no upfront cost; Bestseller Breakthrough is a paid premium package with marketing and distribution add-ons. Please tell support which option you would like to discuss.',
      policyReferences: ['company'],
      factReferences: [],
    },
  },
  {
    name: 'metadata update guidance',
    context: {
      ...baseContext,
      subject: 'Update book description',
      description: 'Can I update the description after publication?',
      category: 'ISBN_METADATA',
    },
    classification: {
      category: 'ISBN_METADATA',
      priority: 'LOW',
      rationale: 'Routine metadata update request.',
    },
    draft: {
      text: 'Yes, metadata updates can be requested through the BookLeaf team. Changes typically reflect on platforms within 3-5 business days. Please share the revised description with support for review.',
      policyReferences: ['metadata'],
      factReferences: [],
    },
  },
];
