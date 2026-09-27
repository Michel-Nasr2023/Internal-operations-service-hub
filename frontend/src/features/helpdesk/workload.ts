import { DirectoryUser } from '../../api/auth';
import { Ticket } from '../../api/tickets';

// Active tickets (assigned + in progress) at which an assignee is flagged. Tune to your team's capacity.
export const MODERATE_LOAD = 3;
export const HIGH_LOAD = 5;
const RECENT_DAYS = 30;

export type LoadLevel = 'available' | 'moderate' | 'high';

export interface AssigneeWorkload {
  employee: DirectoryUser;
  awaitingClaim: number;
  inProgress: number;
  overdue: number;
  active: number;
  resolvedRecently: number;
  nextDueAt?: string;
  activeTickets: Ticket[];
  level: LoadLevel;
}

export function isTicketOverdue(ticket: Ticket, now: number): boolean {
  return ticket.status === 'In Progress' && !!ticket.dueAt && new Date(ticket.dueAt).getTime() <= now;
}

export function loadLevel(active: number): LoadLevel {
  if (active >= HIGH_LOAD) return 'high';
  if (active >= MODERATE_LOAD) return 'moderate';
  return 'available';
}

export function computeWorkload(employees: DirectoryUser[], tickets: Ticket[], now = Date.now()): AssigneeWorkload[] {
  const recentSince = now - RECENT_DAYS * 24 * 60 * 60 * 1000;

  return employees.map((employee) => {
    const theirs = tickets.filter((ticket) => ticket.assigneeId === employee.id);
    const activeTickets = theirs.filter((ticket) => ticket.status === 'Assigned' || ticket.status === 'In Progress');
    const dueDates = activeTickets.map((ticket) => ticket.dueAt).filter((dueAt): dueAt is string => !!dueAt).sort();
    const active = activeTickets.length;

    return {
      employee,
      awaitingClaim: activeTickets.filter((ticket) => ticket.status === 'Assigned').length,
      inProgress: activeTickets.filter((ticket) => ticket.status === 'In Progress').length,
      overdue: activeTickets.filter((ticket) => isTicketOverdue(ticket, now)).length,
      active,
      resolvedRecently: theirs.filter((ticket) => ticket.status === 'Resolved' && !!ticket.resolvedAt && new Date(ticket.resolvedAt).getTime() >= recentSince).length,
      nextDueAt: dueDates[0],
      activeTickets,
      level: loadLevel(active),
    };
  });
}

export const LOAD_LABELS: Record<LoadLevel, string> = {
  available: 'Available',
  moderate: 'Busy',
  high: 'High load',
};
