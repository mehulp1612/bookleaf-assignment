import {
  adminTicketQuerySchema,
  createReplyRequestSchema,
  type UpdateTicketRequest,
} from '@bookleaf/contracts';

export function parseQueue(params: URLSearchParams) {
  return adminTicketQuerySchema.safeParse(Object.fromEntries(params));
}
export function queueSearch(params: URLSearchParams) {
  return new URLSearchParams(
    Object.entries(adminTicketQuerySchema.parse(Object.fromEntries(params))).map(([key, value]) => [
      key,
      String(value),
    ]),
  ).toString();
}
export function ageLabel(createdAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000));
  if (minutes < 60) return `${minutes}m old`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h old`;
  return `${Math.floor(minutes / 1440)}d old`;
}
export interface ReplyAttempt {
  key: string;
  body: string;
  expectedRevision: number;
}
export interface EditorState {
  body: string;
  baseRevision: number | null;
  attempt: ReplyAttempt | null;
  outcome: 'editing' | 'uncertain' | 'conflict';
}
export const emptyEditor: EditorState = {
  body: '',
  baseRevision: null,
  attempt: null,
  outcome: 'editing',
};
export type EditorAction =
  | { type: 'edit' | 'use-draft'; body: string; revision: number }
  | { type: 'attempt'; attempt: ReplyAttempt }
  | { type: 'uncertain' | 'conflict' | 'sent' }
  | { type: 'review'; revision: number };
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'edit':
    case 'use-draft':
      if (state.outcome === 'uncertain') return state;
      return {
        ...state,
        body: action.body,
        baseRevision: state.baseRevision ?? action.revision,
        attempt: null,
      };
    case 'attempt':
      return { ...state, attempt: action.attempt };
    case 'uncertain':
      return { ...state, outcome: 'uncertain' };
    case 'conflict':
      return { ...state, outcome: 'conflict', attempt: null };
    case 'review':
      return { ...state, baseRevision: action.revision, attempt: null, outcome: 'editing' };
    case 'sent':
      return emptyEditor;
  }
}
export function replyAttempt(
  state: EditorState,
  revision: number,
  makeKey: () => string = () => crypto.randomUUID(),
): ReplyAttempt {
  if (state.attempt) return state.attempt;
  const parsed = createReplyRequestSchema.parse({
    body: state.body,
    expectedRevision: state.baseRevision ?? revision,
  });
  return { key: makeKey(), ...parsed };
}
export type TicketChanges = Omit<UpdateTicketRequest, 'expectedRevision'>;
