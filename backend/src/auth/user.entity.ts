import { Column, Entity, PrimaryColumn } from 'typeorm';
import { UserRole } from '../tickets/ticket.types';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn('text')
  id!: string;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column('text')
  password!: string;

  @Column('text')
  role!: UserRole;

  @Column('text')
  firstName!: string;

  @Column('text')
  lastName!: string;

  @Column({ type: 'text', nullable: true })
  jobTitle?: string;

  @Column({ type: 'text', nullable: true })
  employeeId?: string;

  @Column({ type: 'text', default: 'active' })
  status!: 'active' | 'disabled';

  @Column('text')
  createdAt!: string;

  // Profile photo: file name in avatar storage (a random ID), and when it last changed (used to refresh caches).
  @Column({ type: 'text', nullable: true })
  avatarKey?: string | null;

  @Column({ type: 'text', nullable: true })
  avatarUpdatedAt?: string | null;

  @Column({ type: 'text', nullable: true })
  passwordChangedAt?: string | null;

  // Sessions (tokens) issued before this moment are no longer accepted: set on password change or reset,
  // role change, disabling, or "sign out everywhere".
  @Column({ type: 'text', nullable: true })
  sessionsRevokedAt?: string | null;
}
