import { authFetch } from './auth';

export type AuditCategory = 'auth' | 'ticket' | 'access';
export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  category: AuditCategory;
  action: string;
  outcome: AuditOutcome;
  actorId?: string | null;
  actorRole?: string | null;
  actorName?: string;
  targetType?: 'ticket' | 'user' | null;
  targetId?: string | null;
  summary: string;
  details?: Record<string, string | number | boolean | null> | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditLogFilters {
  category?: AuditCategory;
  outcome?: AuditOutcome;
  search?: string;
  before?: string;
}

export interface TicketHistoryEvent {
  id: string;
  action: string;
  actorId: string;
  actorName?: string;
  timestamp: string;
  oldStatus?: string;
  newStatus?: string;
  reason?: string;
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export async function getAuditLog(filters: AuditLogFilters): Promise<{ items: AuditLogEntry[]; nextBefore?: string }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }

  const response = await authFetch(`${apiUrl}/audit-log?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The activity log could not be loaded.');
  }

  return response.json() as Promise<{ items: AuditLogEntry[]; nextBefore?: string }>;
}

export async function getTicketHistory(ticketId: string): Promise<TicketHistoryEvent[]> {
  const response = await authFetch(`${apiUrl}/tickets/${ticketId}/audit-events`);
  if (!response.ok) {
    throw new Error('The ticket history could not be loaded.');
  }

  return response.json() as Promise<TicketHistoryEvent[]>;
}
