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
  title: string;
  description: string;
  teamId: string;
  issueType: string;
  project: string;
  status: string;
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