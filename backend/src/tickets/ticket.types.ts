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

export type AiIssueType = 'hardware' | 'software' | 'network' | 'access';
export type AiSeverity = 'low' | 'medium' | 'high' | 'urgent';

export interface StructuredAiResult {
  employeeId: string;
  jobTitle: string;
  freeText: string;
  productName: string;
  issueType: AiIssueType;
  severity: AiSeverity;
  recommendedAction: string;
}

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
  aiResult?: StructuredAiResult;
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
