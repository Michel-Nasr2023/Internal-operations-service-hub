import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AuditEvent, Priority, Ticket, TicketStatus } from './ticket.types';

@Entity({ name: 'tickets' })
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
  rejectionReason?: string;

  @Column('text')
  createdAt!: string;

  @Column('text')
  updatedAt!: string;

  @Column('integer')
  version!: number;

  @Column('simple-json')
  auditEvents!: AuditEvent[];
}