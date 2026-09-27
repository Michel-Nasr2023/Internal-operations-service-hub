import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// A single-use link for setting a new password. Only a SHA-256 hash of the secret is stored, so a leaked
// database cannot be used to reset anyone's password.
@Entity({ name: 'password_reset_tokens' })
export class PasswordResetTokenEntity {
  @PrimaryColumn('text')
  id!: string;

  @Index()
  @Column('text')
  userId!: string;

  @Index({ unique: true })
  @Column('text')
  tokenHash!: string;

  // "reset" (forgot password or sent by an administrator) or "invite" (new account set up by an administrator).
  @Column('text')
  purpose!: 'reset' | 'invite';

  @Column({ type: 'text', nullable: true })
  requestedBy?: string | null;

  @Column('text')
  expiresAt!: string;

  @Column({ type: 'text', nullable: true })
  usedAt?: string | null;

  @Column('text')
  createdAt!: string;
}
