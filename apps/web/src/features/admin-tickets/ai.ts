import { endpoints, type AiDraft } from '@bookleaf/contracts';
import { ApiClientError, request } from '../../shared/api';

export type DraftLookup = { available: true; draft: AiDraft } | { available: false };
export interface DraftApi {
  latest(id: string, signal?: AbortSignal): Promise<DraftLookup>;
  generate(id: string, regenerate: boolean): Promise<AiDraft>;
}
export const httpDraftApi: DraftApi = {
  async latest(id, signal) {
    try {
      const result = await request(
        `/api/v1/tickets/${encodeURIComponent(id)}/ai-drafts/latest`,
        endpoints.latestDraft.response,
        signal ? { signal } : {},
      );
      return { available: true, draft: result.data };
    } catch (error) {
      if (error instanceof ApiClientError && [404, 501].includes(error.status))
        return { available: false };
      throw error;
    }
  },
  async generate(id, regenerate) {
    return (
      await request(
        `/api/v1/tickets/${encodeURIComponent(id)}/ai-drafts`,
        endpoints.requestDraft.response,
        { method: 'POST', body: JSON.stringify({ regenerate }) },
      )
    ).data;
  },
};
export function draftPending(draft: AiDraft) {
  return draft.state === 'QUEUED' || draft.state === 'RUNNING';
}
export function canRequestDraft(lookup: DraftLookup | undefined, regenerate: boolean) {
  if (!lookup?.available || draftPending(lookup.draft)) return false;
  return regenerate
    ? lookup.draft.state !== 'NOT_REQUESTED'
    : lookup.draft.state === 'NOT_REQUESTED';
}
