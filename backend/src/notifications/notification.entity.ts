import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export const NOTIFICATION_KINDS = [
  'ticket-submitted',
  'ticket-approved',
  'ticket-rejected',
  'ticket-assigned',
  'ticket-unclaimed',
  'ticket-overdue',
  'ticket-resolved',
  'ticket-comment',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// One row per recipient. `dedupeKey` + recipient is unique so an alert (e.g. "unclaimed for 24h")
// is stored at most once per person, even if the scheduled check runs many times.
@Entity({ name: 'notifications' })
@Index(['recipientId', 'dedupeKey'], { unique: true })
export class NotificationEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  recipientId!: string;

  @Column('text')
  ticketId!: string;

  @Column('text')
  kind!: NotificationKind;

  @Column('text')
  title!: string;

  @Column('text')
  message!: string;

  @Column('text')
  dedupeKey!: string;

  @Column('text')
  createdAt!: string;

  @Column({ type: 'text', nullable: true })
  readAt?: string | null;
}
