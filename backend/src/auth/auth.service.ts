import { BadRequestException, ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser, UserRole } from '../tickets/ticket.types';
import { LoginRequestDto, SignupRequestDto } from './auth.dto';
import { passwordProblem } from './password-policy';
import { hashPassword, isHashedPassword, verifyPassword } from './password';
import { signToken } from './token';
import { UserEntity } from './user.entity';
import { AuditService } from '../audit/audit.service';

export type AuthenticatedSession = AuthenticatedUser & {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  employeeId?: string;
  avatarUpdatedAt?: string | null;
  token: string;
};

export interface DirectoryUser {
  id: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  jobTitle?: string;
  avatarUpdatedAt?: string | null;
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultUsers();
    await this.ensureAdministrator();
  }

  // Guarantees there is always a way into the admin area, including on databases created before it existed.
  private async ensureAdministrator(): Promise<void> {
    if ((await this.userRepository.count({ where: { role: 'administrator' } })) > 0) return;
    if (await this.userRepository.findOneBy({ email: 'admin@company.com' })) return;

    await this.userRepository.save({
      id: 'admin-1',
      email: 'admin@company.com',
      password: hashPassword('Admin12345'),
      role: 'administrator',
      firstName: 'Ada',
      lastName: 'Admin',
      jobTitle: 'System Administrator',
      employeeId: 'ADM-0001',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  }

  async login(dto: LoginRequestDto): Promise<AuthenticatedSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    if (!user || !verifyPassword(dto.password, user.password)) {
      // The client always sees the same message; the log records which check failed.
      await this.recordLoginFailure(normalizedEmail, user ? 'wrong password' : 'unknown email', user);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      await this.recordLoginFailure(normalizedEmail, 'account disabled', user);
      throw new UnauthorizedException('This account is not active');
    }

    if (!isHashedPassword(user.password)) {
      await this.userRepository.update({ id: user.id }, { password: hashPassword(dto.password) });
    }

    await this.auditService.record({
      category: 'auth',
      action: 'LOGIN_SUCCEEDED',
      actor: user,
      target: { type: 'user', id: user.id },
      summary: `${fullName(user)} signed in`,
    });
    return this.toSession(user);
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    const record = await this.userRepository.findOneBy({ id: user.id });
    await this.auditService.record({
      category: 'auth',
      action: 'LOGOUT',
      actor: user,
      target: { type: 'user', id: user.id },
      summary: `${record ? fullName(record) : user.id} signed out`,
    });
  }

  private async recordLoginFailure(email: string, reason: string, user: UserEntity | null): Promise<void> {
    await this.auditService.record({
      category: 'auth',
      action: 'LOGIN_FAILED',
      outcome: 'failure',
      target: user ? { type: 'user', id: user.id } : undefined,
      summary: `Failed sign-in for ${email} (${reason})`,
      details: { email, reason },
    });
  }

  async signup(dto: SignupRequestDto): Promise<AuthenticatedSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    const weakness = passwordProblem(dto.password);
    if (weakness) throw new BadRequestException(weakness);

    if (existing) {
      await this.auditService.record({
        category: 'auth',
        action: 'SIGNUP_FAILED',
        outcome: 'failure',
        summary: `Sign-up refused for ${normalizedEmail} (email already registered)`,
        details: { email: normalizedEmail, reason: 'email already registered' },
      });
      throw new ConflictException('An account with this email already exists');
    }

    const id = await this.nextUserId();
    const now = new Date().toISOString();

    const user = await this.userRepository.save({
      id,
      email: normalizedEmail,
      password: hashPassword(dto.password),
      // Self-service accounts are always employees; Helpdesk access is granted with `npm run user:role`.
      role: 'employee',
      firstName: dto.firstName,
      lastName: dto.lastName,
      jobTitle: dto.jobTitle,
      employeeId: id,
      status: 'active',
      createdAt: now,
    });

    await this.auditService.record({
      category: 'auth',
      action: 'SIGNUP',
      actor: user,
      target: { type: 'user', id: user.id },
      summary: `${fullName(user)} created an employee account (${normalizedEmail})`,
    });
    return this.toSession(user);
  }

  // Active people only: disabled accounts cannot be assigned work.
  async listUsers(role?: UserRole): Promise<DirectoryUser[]> {
    const users = await this.userRepository.find({ where: { status: 'active', ...(role ? { role } : {}) } });

    return users.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      jobTitle: user.jobTitle,
      avatarUpdatedAt: user.avatarUpdatedAt ?? null,
    }));
  }

  private toSession(user: UserEntity): AuthenticatedSession {
    return {
      id: user.id,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: user.jobTitle,
      employeeId: user.employeeId,
      avatarUpdatedAt: user.avatarUpdatedAt ?? null,
      token: signToken({ id: user.id, role: user.role }),
    };
  }

  // Next free numeric account ID; also used when administrators create accounts.
  async nextUserId(): Promise<string> {
    const users = await this.userRepository.find();
    const highestNumericId = users.reduce((highest, user) => {
      const parsed = Number(user.id);
      return Number.isInteger(parsed) && parsed > highest ? parsed : highest;
    }, 0);

    return String(highestNumericId + 1);
  }

  private async seedDefaultUsers(): Promise<void> {
    const existingCount = await this.userRepository.count();
    if (existingCount > 0) {
      return;
    }

    const now = new Date().toISOString();
    const employees = [
      {
        id: 'employee-1',
        email: 'employee@company.com',
        password: 'employee123',
        role: 'employee' as const,
        firstName: 'Maya',
        lastName: 'Stone',
        jobTitle: 'Operations Analyst',
        employeeId: 'EMP-1001',
      },
      {
        id: 'helpdesk-1',
        email: 'helpdesk@company.com',
        password: 'helpdesk123',
        role: 'helpdesk' as const,
        firstName: 'Leo',
        lastName: 'Warren',
        jobTitle: 'Helpdesk Lead',
        employeeId: 'HELP-2001',
      },
    ];

    await this.userRepository.save(
      employees.map((employee) => ({
        ...employee,
        password: hashPassword(employee.password),
        status: 'active',
        createdAt: now,
      })),
    );
  }
}

function fullName(user: Pick<UserEntity, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
