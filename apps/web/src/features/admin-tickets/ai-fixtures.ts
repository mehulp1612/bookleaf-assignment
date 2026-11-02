// Explicit test/development adapter; never installed as the application's HTTP fallback.
import { aiDraftSchema, type AiDraft } from '@bookleaf/contracts';
import { failedDraftFixture, pendingDraftFixture } from '@bookleaf/contracts/fixtures';
import type { DraftApi } from './ai';

export const readyDraftFixture = aiDraftSchema.parse({
  ...pendingDraftFixture,
  state: 'SUCCEEDED',
  text: 'Fixture suggestion only: thank you for your question. Please review the verified book information before replying.',
});
export function createDraftFixtureApi(initial: AiDraft = { state: 'NOT_REQUESTED' }) {
  let draft = aiDraftSchema.parse(initial);
  const calls: { method: 'GET' | 'POST'; regenerate?: boolean }[] = [];
  const api: DraftApi = {
    latest: async () => {
      calls.push({ method: 'GET' });
      return { available: true, draft };
    },
    generate: async (_id, regenerate) => {
      calls.push({ method: 'POST', regenerate });
      draft = pendingDraftFixture;
      return draft;
    },
  };
  return {
    api,
    calls,
    complete: () => {
      draft = readyDraftFixture;
    },
    fail: () => {
      draft = failedDraftFixture;
    },
    set: (value: AiDraft) => {
      draft = aiDraftSchema.parse(value);
    },
  };
}
