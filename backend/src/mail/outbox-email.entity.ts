import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// Every email the system sends, with its delivery result, so administrators can see whether mail went out
// (Admin > System). When no mail server is configured, this outbox is also where the emails can be read.
@Entity({ name: 'email_outbox' })
@Index(['createdAt'])
export class OutboxEmailEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  to!: string;

  @Column('text')
  subject!: string;

  // Plain-text version of the email.
  @Column('text')
  body!: string;

  // What the email is for, e.g. "password-reset" or "account-invite".
  @Column('text')
  purpose!: string;

  // sent: accepted by the mail server · failed: the server refused or could not be reached ·
  // not-configured: no mail server set up, so it was only recorded here and in the console.
  @Column({ type: 'text', default: 'not-configured' })
  status!: 'sent' | 'failed' | 'not-configured';

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'text', nullable: true })
  sentAt?: string | null;

  @Column('text')
  createdAt!: string;
}
