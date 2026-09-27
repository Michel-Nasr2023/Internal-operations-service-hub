export enum TicketStatus {
  CREATED = 'Created',
  PENDING_HELPDESK_REVIEW = 'Pending Helpdesk Review',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
  ASSIGNED = 'Assigned',
  IN_PROGRESS = 'In Progress',
  RESOLVED = 'Resolved',
}

export enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export type UserRole = 'employee' | 'helpdesk' | 'assignee' | 'administrator';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

export const TEAM_IDS = ['it', 'facilities', 'finance'] as const;

export const AI_ISSUE_TYPES = ['hardware', 'software', 'network', 'access'] as const;
export const AI_SEVERITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type AiIssueType = (typeof AI_ISSUE_TYPES)[number];
export type AiSeverity = (typeof AI_SEVERITIES)[number];

// AI intake analysis attached to a ticket, written for the Helpdesk reviewer. It runs in the background after
// submission, so a ticket's analysis is first `pending`, then either the model's result or a recorded failure.
export interface TicketAiResult {
  source: 'ai';
  model?: string;
  summary: string;
  clarifiedDescription: string;
  issueType: AiIssueType;
  severity: AiSeverity;
  recommendedAction: string;
  missingInformation: string[];
  // The model could not tell what the problem is and suggests clarifying with the employee.
  isUnclear?: boolean;
  attempts?: number;
  generatedAt: string;
}

export type AiFailureCode = 'not-configured' | 'timeout' | 'rate-limited' | 'provider-error' | 'network' | 'invalid-response';

export interface TicketAiFailure {
  source: 'failed';
  failureCode: AiFailureCode;
  // Plain-language reason shown to Helpdesk.
  failureReason: string;
  attempts: number;
  generatedAt: string;
}

export interface TicketAiPending {
  source: 'pending';
  requestedAt: string;
}

export type TicketAiAnalysis = TicketAiResult | TicketAiFailure | TicketAiPending;

export interface AuditEvent {
  id: string;
  action: string;
  actorId: string;
  ticketId: string;
  timestamp: string;
  oldStatus?: TicketStatus;
  newStatus?: TicketStatus;
  reason?: string;
}

export interface Ticket {
  id: string;
  requesterId: string;
  teamId: string;
  issueType: string;
  project: string;
  title: string;
  description: string;
  aiResult?: TicketAiAnalysis;
  priority?: Priority;
  status: TicketStatus;
  assigneeId?: string;
  assignedAt?: string;
  expectedDurationHours?: number;
  claimedAt?: string;
  dueAt?: string;
  resolvedAt?: string;
  resolutionFeedback?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  auditEvents: AuditEvent[];
}

export interface TicketComment {
  id: string;
  ticketId: string;
  authorId: string;
  authorName?: string;
  authorRole?: UserRole;
  body: string;
  createdAt: string;
}

// Ticket as returned by the API, with display names resolved from the user directory.
export interface TicketView extends Ticket {
  requesterName?: string;
  assigneeName?: string;
  // When the requesting user last opened this ticket's details (only set on list responses).
  viewedAt?: string;
  attachmentCount?: number;
}
