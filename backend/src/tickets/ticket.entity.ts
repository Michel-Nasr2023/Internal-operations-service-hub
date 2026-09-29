import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { AuditEvent, Priority, TicketAiAnalysis, Ticket, TicketStatus } from './ticket.types';

// Indexes for the common lookups: an employee's own requests, their assigned work, and tickets by status
// (queues, scheduled alerts, dashboards).
@Entity({ name: 'tickets' })
@Index(['requesterId'])
@Index(['assigneeId', 'status'])
@Index(['status'])
// One ticket per submission, even if the same submission arrives twice at the same moment.
@Index(['requesterId', 'submissionKey'], { unique: true })
export class TicketEntity implements Ticket {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  requesterId!: string;

  @Column('text')
  teamId!: string;

  @Column('text')
  issueType!: string;

  @Column('text')
  project!: string;

  @Column('text')
  title!: string;

  @Column('text')
  description!: string;

  @Column({ type: 'simple-json', nullable: true })
  aiResult?: TicketAiAnalysis;

  @Column({ type: 'text', nullable: true })
  priority?: Priority;

  @Column('text')
  status!: TicketStatus;

  @Column({ type: 'text', nullable: true })
  assigneeId?: string;

  @Column({ type: 'text', nullable: true })
  assignedAt?: string;

  @Column({ type: 'integer', nullable: true })
  expectedDurationHours?: number;

  @Column({ type: 'text', nullable: true })
  claimedAt?: string;

  @Column({ type: 'text', nullable: true })
  dueAt?: string;

  @Column({ type: 'text', nullable: true })
  resolvedAt?: string;

  @Column({ type: 'text', nullable: true })
  resolutionFeedback?: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  // Helpdesk member who approved or rejected the ticket, and when.
  @Column({ type: 'text', nullable: true })
  reviewedBy?: string;

  @Column({ type: 'text', nullable: true })
  reviewedAt?: string;

  // Helpdesk member (or administrator) who gave the ticket to its current assignee.
  @Column({ type: 'text', nullable: true })
  assignedBy?: string;

  @Column('text')
  createdAt!: string;

  @Column('text')
  updatedAt!: string;

  @Column('integer')
  version!: number;

  @Column('simple-json')
  auditEvents!: AuditEvent[];

  @Column({ type: 'text', nullable: true })
  submissionKey?: string;
}