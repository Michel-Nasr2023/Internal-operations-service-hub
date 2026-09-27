import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type AuditCategory = 'auth' | 'ticket' | 'access';
export type AuditOutcome = 'success' | 'failure' | 'denied';

// System-wide, append-only audit trail. Rows are only ever inserted: there is no update or delete path.
// Never store passwords, tokens, or full ticket text here — only IDs and short summaries.
@Entity({ name: 'audit_log' })
@Index(['timestamp'])
@Index(['targetType', 'targetId'])
export class AuditLogEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  timestamp!: string;

  @Column('text')
  category!: AuditCategory;

  @Column('text')
  action!: string;

  @Column('text')
  outcome!: AuditOutcome;

  @Column({ type: 'text', nullable: true })
  actorId?: string | null;

  @Column({ type: 'text', nullable: true })
  actorRole?: string | null;

  @Column({ type: 'text', nullable: true })
  targetType?: 'ticket' | 'user' | null;

  @Column({ type: 'text', nullable: true })
  targetId?: string | null;

  @Column('text')
  summary!: string;

  @Column({ type: 'simple-json', nullable: true })
  details?: Record<string, string | number | boolean | null> | null;

  @Column({ type: 'text', nullable: true })
  ip?: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent?: string | null;

  @Column({ type: 'text', nullable: true })
  requestId?: string | null;
}
