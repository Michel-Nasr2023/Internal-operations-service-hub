import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// A single-use way to set a new password: a secret link and, for resets, a 6-digit code sent in the same email.
// Only SHA-256 hashes are stored, so a leaked database cannot be used to reset anyone's password.
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

  // Hash of the 6-digit code (reset emails only).
  @Column({ type: 'text', nullable: true })
  codeHash?: string | null;

  // Wrong codes entered; the code stops working after too many.
  @Column({ type: 'integer', default: 0 })
  failedAttempts!: number;

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
