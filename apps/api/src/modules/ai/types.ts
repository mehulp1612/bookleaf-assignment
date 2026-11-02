import { z } from 'zod';
import {
  bookSchema,
  categorySchema,
  idSchema,
  moneyPaiseSchema,
  prioritySchema,
} from '@bookleaf/contracts';

export const classificationSchema = z.strictObject({
  category: categorySchema,
  priority: prioritySchema,
  rationale: z.string().trim().min(1).max(600),
});
export const draftSchema = z.strictObject({
  text: z.string().trim().min(1).max(6000),
  policyReferences: z.array(z.string().min(1).max(40)).min(1).max(8),
  factReferences: z.array(z.string().min(1).max(80)).max(30),
});
export const contextSchema = z.object({
  ticketId: idSchema,
  authorId: idSchema,
  contextRevision: z.number().int().nonnegative(),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10000),
  category: categorySchema.nullable(),
  book: bookSchema.nullable(),
  account: z
    .object({
      authorId: idSchema,
      bookCount: z.number().int().nonnegative(),
      totalRoyaltyEarnedPaise: moneyPaiseSchema,
      royaltyPaidPaise: moneyPaiseSchema,
      royaltyPendingPaise: moneyPaiseSchema,
    })
    .nullable(),
  publicReplies: z.array(z.object({ body: z.string().max(10000) })).max(100),
});
export type AiContext = z.infer<typeof contextSchema>;
export type Classification = z.infer<typeof classificationSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type Task = 'CLASSIFICATION' | 'DRAFT';
export interface GenerationRequest {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  signal?: AbortSignal;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface Provider {
  // Safe, stable identity: never contains credentials or raw endpoint query parameters.
  identity: string;
  generate(request: GenerationRequest): Promise<{ text: string; usage?: Usage }>;
}
