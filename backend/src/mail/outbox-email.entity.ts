import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// Every email the system sends. Until a real mail provider is configured, this table (shown to administrators)
// and the server console are where the emails can be read.
@Entity({ name: 'email_outbox' })
@Index(['createdAt'])
export class OutboxEmailEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  to!: string;

  @Column('text')
  subject!: string;

  @Column('text')
  body!: string;

  // What the email is for, e.g. "password-reset" or "account-invite".
  @Column('text')
  purpose!: string;

  @Column('text')
  createdAt!: string;
}
