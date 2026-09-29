import { authFetch } from './auth';
import { AuditLogEntry } from './audit';

export type ManagedRole = 'employee' | 'helpdesk' | 'administrator';

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  role: ManagedRole | 'assignee';
  status: 'active' | 'disabled';
  employeeId?: string;
  avatarUpdatedAt: string | null;
  createdAt: string;
  passwordChangedAt: string | null;
  lastSignInAt: string | null;
  activeAssignments: number;
  openRequests: number;
}

export interface AdminOverview {
  users: { total: number; active: number; disabled: number; byRole: Record<string, number> };
  tickets: {
    total: number;
    byStatus: Record<string, number>;
    open: number;
    overdue: number;
    unassignedApproved: number;
    aiPending: number;
    aiFailed: number;
  };
  security: { failedSignIns24h: number; deniedRequests24h: number; recent: AuditLogEntry[] };
}

export interface SystemStatus {
  database: { ok: boolean; responseMs: number };
  ai: { configured: boolean; model: string; pending: number; failed: number };
  authSecretConfigured: boolean;
  email: {
    mode: 'smtp' | 'outbox-only';
    host?: string;
    from?: string;
    connection: 'ok' | 'failed' | 'unchecked' | 'not-configured';
    connectionError?: string;
    lastSentAt?: string | null;
    lastFailure?: { at: string; error: string } | null;
  };
  notificationCheckIntervalMs: number;
  uptimeSeconds: number;
  nodeVersion: string;
}

export interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  purpose: string;
  // retrying: a temporary problem; the server sends it again automatically at nextAttemptAt.
  status: 'sent' | 'retrying' | 'failed' | 'not-configured';
  error?: string | null;
  attempts?: number;
  nextAttemptAt?: string | null;
  sentAt?: string | null;
  createdAt: string;
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

async function request<T>(path: string, init: RequestInit = {}, fallback = 'The request failed.'): Promise<T> {
  const response = await authFetch(`${apiUrl}/admin${path}`, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error((Array.isArray(error?.message) ? error.message.join(' ') : error?.message) ?? fallback);
  }
  return response.json() as Promise<T>;
}

export const getAdminOverview = () => request<AdminOverview>('/overview', {}, 'The overview could not be loaded.');

export function listAdminUsers(filters: { search?: string; role?: string; status?: string }): Promise<AdminUser[]> {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => !!value) as Array<[string, string]>);
  return request<AdminUser[]>(`/users?${params.toString()}`, {}, 'Users could not be loaded.');
}

export const createAdminUser = (input: { email: string; firstName: string; lastName: string; jobTitle?: string; role: ManagedRole }) =>
  request<AdminUser>('/users', { method: 'POST', body: JSON.stringify(input) }, 'The account could not be created.');

export const updateAdminUser = (id: string, changes: Partial<Pick<AdminUser, 'email' | 'firstName' | 'lastName' | 'jobTitle' | 'status'>> & { role?: ManagedRole }) =>
  request<AdminUser>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) }, 'The account could not be updated.');

// Moves the person's Assigned / In Progress tickets to another employee or back to the Helpdesk queue.
export const handOverUserTickets = (id: string, choice: { mode: 'reassign'; toUserId: string } | { mode: 'queue' }) =>
  request<{ moved: number; message: string }>(`/users/${encodeURIComponent(id)}/handover`, { method: 'POST', body: JSON.stringify(choice) }, 'The tickets could not be handed over.');

export const sendUserPasswordReset = (id: string) =>
  request<{ message: string }>(`/users/${encodeURIComponent(id)}/password-reset`, { method: 'POST' }, 'The reset link could not be sent.');

export const signOutUserEverywhere = (id: string) =>
  request<{ message: string }>(`/users/${encodeURIComponent(id)}/sign-out`, { method: 'POST' }, 'The user could not be signed out.');

export const getEmailOutbox = () => request<OutboxEmail[]>('/email-outbox', {}, 'The email outbox could not be loaded.');

export const getSystemStatus = () => request<SystemStatus>('/system', {}, 'System status could not be loaded.');
