import { getAuthHeaders } from './auth';

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
  aiResult?: {
    employeeId: string;
    jobTitle: string;
    freeText: string;
    productName: string;
    issueType: 'hardware' | 'software' | 'network' | 'access';
    severity: 'low' | 'medium' | 'high' | 'urgent';
    recommendedAction: string;
  };
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export async function getMyTickets(): Promise<Ticket[]> {
  const response = await fetch(`${apiUrl}/tickets`, { headers: getAuthHeaders() });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Your saved tickets could not be loaded.');
  }

  return response.json() as Promise<Ticket[]>;
}

// Same endpoint as getMyTickets; the backend returns every ticket when the caller is Helpdesk.
export const getTickets = getMyTickets;

export async function approveTicket(id: string, priority: string): Promise<Ticket> {
  const response = await fetch(`${apiUrl}/tickets/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ priority }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be approved.');
  }

  return response.json() as Promise<Ticket>;
}

export async function rejectTicket(id: string, reason: string): Promise<Ticket> {
  const response = await fetch(`${apiUrl}/tickets/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be rejected.');
  }

  return response.json() as Promise<Ticket>;
}

export async function assignTicket(id: string, assigneeId: string, expectedDurationHours: number): Promise<Ticket> {
  const response = await fetch(`${apiUrl}/tickets/${id}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ assigneeId, expectedDurationHours }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be assigned.');
  }

  return response.json() as Promise<Ticket>;
}

export async function claimTicket(id: string): Promise<Ticket> {
  const response = await fetch(`${apiUrl}/tickets/${id}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be claimed.');
  }

  return response.json() as Promise<Ticket>;
}

export async function resolveTicket(id: string, feedback: string): Promise<Ticket> {
  const response = await fetch(`${apiUrl}/tickets/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ feedback }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be resolved.');
  }

  return response.json() as Promise<Ticket>;
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const response = await fetch(`${apiUrl}/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The ticket could not be created.');
  }

  return response.json() as Promise<Ticket>;
}