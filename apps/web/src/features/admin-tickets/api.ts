import { endpoints, type UpdateTicketRequest } from '@bookleaf/contracts';
import { request } from '../../shared/api';
import type { ReplyAttempt } from './model';

const ticketPath = (id: string) => `/api/v1/tickets/${encodeURIComponent(id)}`;
export const adminApi = {
  list: (search: string, signal: AbortSignal) =>
    request(`/api/v1/tickets?${search}`, endpoints.adminTickets.response, { signal }),
  detail: (id: string, signal: AbortSignal) =>
    request(ticketPath(id), endpoints.adminTicket.response, { signal }),
  update: (id: string, input: UpdateTicketRequest) =>
    request(ticketPath(id), endpoints.updateTicket.response, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  reply: (id: string, attempt: ReplyAttempt) =>
    request(`${ticketPath(id)}/replies`, endpoints.reply.response, {
      method: 'POST',
      headers: { 'Idempotency-Key': attempt.key },
      body: JSON.stringify({ body: attempt.body, expectedRevision: attempt.expectedRevision }),
    }),
  note: (id: string, body: string) =>
    request(`${ticketPath(id)}/notes`, endpoints.note.response, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
};
