import { createHash } from 'node:crypto';
import { categorySchema } from '@bookleaf/contracts';
import { knowledgeBase, type PolicySection } from './knowledge-base.v1.js';
import { contextSchema, type AiContext, type Task } from './types.js';

export const PROMPT_VERSION = 'bookleaf-assistance-2';
const categorySections: Record<(typeof categorySchema.options)[number], PolicySection[]> = {
  ROYALTY_PAYMENTS: ['royalties'],
  ISBN_METADATA: ['isbn', 'metadata'],
  PRINTING_QUALITY: ['printing'],
  DISTRIBUTION_AVAILABILITY: ['distribution'],
  BOOK_STATUS_PRODUCTION: ['production'],
  GENERAL_INQUIRY: ['company'],
};
const matches: [PolicySection, RegExp][] = [
  ['royalties', /royalt|payout|payment|bank|profit|commission|sold/i],
  ['isbn', /isbn|imprint/i],
  ['metadata', /metadata|description|bio\b|title update/i],
  [
    'printing',
    /print quality|misprint|binding|blurry|misalign|defect|author cop|reprint|print turnaround/i,
  ],
  ['distribution', /unavailable|stock|listing|distribut|amazon|flipkart/i],
  ['production', /production|typesett|proof|cover|manuscript|publish|editing/i],
];
export function selectSections(context: AiContext): PolicySection[] {
  const selected = new Set<PolicySection>(['company', 'communication']);
  if (context.category)
    for (const section of categorySections[context.category]) selected.add(section);
  for (const [section, pattern] of matches)
    if (pattern.test(`${context.subject}\n${context.description}`)) selected.add(section);
  return [...selected].sort();
}

export function prepareContext(input: AiContext, task: Task) {
  const context = contextSchema.parse(input); // strips notes, emails and any undeclared fields
  if (
    (context.book && context.book.authorId !== context.authorId) ||
    (context.account && context.account.authorId !== context.authorId)
  ) {
    throw new Error('AI context ownership mismatch.');
  }
  // Classification uses the original query, not a subsequent manual category override.
  const selectionContext = task === 'CLASSIFICATION' ? { ...context, category: null } : context;
  const sections = selectSections(selectionContext);
  const facts: Record<string, string | number | null | string[]> = {};
  if (task === 'DRAFT') {
    const book = context.book;
    if (book) {
      facts['book.title'] = book.title;
      facts['book.status'] = book.status;
      if (sections.includes('royalties')) {
        for (const key of [
          'mrpPaise',
          'authorRoyaltyPerCopyPaise',
          'totalRoyaltyEarnedPaise',
          'royaltyPaidPaise',
          'royaltyPendingPaise',
        ] as const) {
          const amount = book[key];
          facts[`book.${key.replace('Paise', 'INR')}`] =
            amount === null
              ? null
              : `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
        }
        facts['book.totalCopiesSold'] = book.totalCopiesSold;
        facts['book.lastRoyaltyPayoutDate'] = book.lastRoyaltyPayoutDate;
      }
      if (sections.includes('isbn') || sections.includes('metadata'))
        facts['book.isbn'] = book.isbn;
      if (sections.includes('distribution')) facts['book.availableOn'] = book.availableOn;
      if (sections.includes('printing')) facts['book.printPartner'] = book.printPartner;
      if (sections.includes('production') || sections.includes('distribution'))
        facts['book.publicationDate'] = book.publicationDate;
    } else if (context.account && sections.includes('royalties')) {
      for (const key of [
        'totalRoyaltyEarnedPaise',
        'royaltyPaidPaise',
        'royaltyPendingPaise',
      ] as const) {
        const amount = context.account[key];
        facts[`account.${key.replace('Paise', 'INR')}`] =
          `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
      }
      facts['account.bookCount'] = context.account.bookCount;
    }
  }
  const policies = sections.map((id) => ({ id, text: knowledgeBase.sections[id] }));
  const payload = {
    query: { subject: context.subject, description: context.description },
    effectiveCategory: task === 'DRAFT' ? context.category : null,
    verifiedCatalogSnapshot: facts,
    publicReplies:
      task === 'DRAFT'
        ? context.publicReplies.slice(-3).map((reply) => reply.body.slice(0, 1500))
        : [],
  };
  return { context, sections, policies, payload, facts };
}
export function fingerprint(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, canonical(val)]),
      );
    return item;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
