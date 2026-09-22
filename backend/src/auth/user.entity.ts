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
}
