import { authFetch } from './auth';

export interface CreateTicketInput {
  title: string;
  description: string;
  teamId: string;
  issueType: string;
  project: string;
}

export interface Ticket {
  id: string;
  requesterId: string;
  title: string;
  description: string;
  teamId: string;
  issueType: string;
  project: string;
  status: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
  assignedAt?: string;
  expectedDurationHours?: number;
  claimedAt?: string;
  dueAt?: string;
  resolvedAt?: string;
  resolutionFeedback?: string;
  rejectionReason?: string;
  createdAt: string;
  requesterName?: string;
  assigneeName?: string;
  // When the current user last opened this ticket's details.
  viewedAt?: string;
  attachmentCount?: number;
  aiResult?: TicketAiAnalysis;
}

// AI intake analysis for Helpdesk. Tickets created before the AI redesign stored a different shape,
// so every field is optional.
// `pending` while the AI works in the background, `ai` for its answer, `failed` when it could not answer.
// `fallback` is the old rule-based guess stored on earlier tickets.
export interface TicketAiAnalysis {
  source?: 'pending' | 'ai' | 'failed' | 'fallback';
  summary?: string;
  clarifiedDescription?: string;
  issueType?: 'hardware' | 'software' | 'network' | 'access';
  severity?: 'low' | 'medium' | 'high' | 'urgent';
  recommendedAction?: string;
  missingInformation?: string[];
  isUnclear?: boolean;
  failureCode?: string;
  failureReason?: string;
  attempts?: number;
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export async function getMyTickets(): Promise<Ticket[]> {
  const response = await authFetch(`${apiUrl}/tickets`);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Your saved tickets could not be loaded.');
  }

  return response.json() as Promise<Ticket[]>;
}

export async function getTicket(id: string): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets/${id}`);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be loaded.');
  }

  return response.json() as Promise<Ticket>;
}

// Helpdesk: run the AI analysis again after it failed.
export async function retryTicketAnalysis(id: string): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets/${id}/ai-analysis`, { method: 'POST' });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The AI analysis could not be restarted.');
  }

  return response.json() as Promise<Ticket>;
}

// Same endpoint as getMyTickets; the backend returns every ticket when the caller is Helpdesk.
export const getTickets = getMyTickets;

// With `assignment`, approves and assigns in one request: the backend does both or neither.
export async function approveTicket(id: string, priority: string, assignment?: { assigneeId: string; expectedDurationHours: number }): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority, ...assignment }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be approved.');
  }

  return response.json() as Promise<Ticket>;
}

export async function rejectTicket(id: string, reason: string): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be rejected.');
  }

  return response.json() as Promise<Ticket>;
}

export async function assignTicket(id: string, assigneeId: string, expectedDurationHours: number): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets/${id}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assigneeId, expectedDurationHours }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be assigned.');
  }

  return response.json() as Promise<Ticket>;
}

// Records that the current user opened the ticket (clears its "new" highlight). Failures are ignored.
export async function markTicketViewed(id: string): Promise<void> {
  await authFetch(`${apiUrl}/tickets/${id}/view`, { method: 'POST' }).catch(() => undefined);
}

export async function claimTicket(id: string): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets/${id}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be claimed.');
  }

  return response.json() as Promise<Ticket>;
}

export async function resolveTicket(id: string, feedback: string): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be resolved.');
  }

  return response.json() as Promise<Ticket>;
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const response = await authFetch(`${apiUrl}/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be created.');
  }

  return response.json() as Promise<Ticket>;
}
export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string;
  authorName?: string;
  authorRole?: 'employee' | 'helpdesk' | 'assignee' | 'administrator';
  body: string;
  createdAt: string;
}

export async function getTicketComments(ticketId: string): Promise<TicketComment[]> {
  const response = await authFetch(`${apiUrl}/tickets/${ticketId}/comments`);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Comments could not be loaded.');
  }

  return response.json() as Promise<TicketComment[]>;
}

export async function addTicketComment(ticketId: string, body: string): Promise<TicketComment> {
  const response = await authFetch(`${apiUrl}/tickets/${ticketId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The comment could not be added.');
  }

  return response.json() as Promise<TicketComment>;
}
