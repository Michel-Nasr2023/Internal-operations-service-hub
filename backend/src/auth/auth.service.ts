import { BadRequestException, ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { AuthenticatedUser, UserRole } from '../tickets/ticket.types';
import { LoginRequestDto, SignupRequestDto } from './auth.dto';
import { passwordProblem } from './password-policy';
import { hashPassword, isHashedPassword, verifyPassword } from './password';
import { signToken } from './token';
import { UserEntity } from './user.entity';
import { AuditService } from '../audit/audit.service';
import { currentRequestContext } from '../audit/request-context';
import { AttemptLimiter, TooManyAttemptsException, waitDescription } from '../common/attempt-limiter';
import { maskEmail } from '../common/log-safe';

export type AuthenticatedSession = AuthenticatedUser & {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  employeeId?: string;
  avatarUpdatedAt?: string | null;
  token: string;
};

export type NewAccount = Pick<UserEntity, 'email' | 'password' | 'role' | 'firstName' | 'lastName' | 'jobTitle' | 'status' | 'createdAt'>;

export interface DirectoryUser {
  id: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  jobTitle?: string;
  avatarUpdatedAt?: string | null;
}

const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const FAILED_SIGN_INS_PER_ACCOUNT = 5;
// Higher, because colleagues in one office usually share a network address.
const FAILED_SIGN_INS_PER_ADDRESS = 30;
const SIGN_UPS_PER_ADDRESS_PER_HOUR = 20;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly failedSignInsByAccount = new AttemptLimiter(FAILED_SIGN_INS_PER_ACCOUNT, SIGN_IN_WINDOW_MS);
  private readonly failedSignInsByAddress = new AttemptLimiter(FAILED_SIGN_INS_PER_ADDRESS, SIGN_IN_WINDOW_MS);
  private readonly signUpsByAddress = new AttemptLimiter(SIGN_UPS_PER_ADDRESS_PER_HOUR, 60 * 60 * 1000);

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

    await this.userRepository.insert({
      id: 'admin-1',
      email: 'admin@company.com',
      password: await hashPassword('Admin12345'),
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
    const address = currentRequestContext()?.ip ?? 'unknown';

    // Checked before any database or password work, so a flood of guesses is cheap to turn away.
    const accountWait = this.failedSignInsByAccount.blockedFor(normalizedEmail);
    if (accountWait > 0) {
      throw new TooManyAttemptsException(
        `Too many failed sign-in attempts for this account. Try again ${waitDescription(accountWait)}, or reset your password.`,
        accountWait,
      );
    }
    const addressWait = this.failedSignInsByAddress.blockedFor(address);
    if (addressWait > 0) {
      throw new TooManyAttemptsException(`Too many failed sign-in attempts from your network. Try again ${waitDescription(addressWait)}.`, addressWait);
    }

    const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    if (!user || !(await verifyPassword(dto.password, user.password))) {
      // The client always sees the same message; the log records which check failed.
      await this.recordLoginFailure(normalizedEmail, user ? 'wrong password' : 'unknown email', user);
      await this.countFailedSignIn(normalizedEmail, address, user);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      await this.recordLoginFailure(normalizedEmail, 'account disabled', user);
      throw new UnauthorizedException('This account is not active');
    }

    this.failedSignInsByAccount.reset(normalizedEmail);
    if (!isHashedPassword(user.password)) {
      await this.userRepository.update({ id: user.id }, { password: await hashPassword(dto.password) });
    }

    await this.auditService.record({
      category: 'auth',
      action: 'LOGIN_SUCCEEDED',
      actor: user,
      target: { type: 'user', id: user.id },
      summary: 'Signed in',
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
      summary: 'Signed out',
    });
  }

  private async recordLoginFailure(email: string, reason: string, user: UserEntity | null): Promise<void> {
    await this.auditService.record({
      category: 'auth',
      action: 'LOGIN_FAILED',
      outcome: 'failure',
      target: user ? { type: 'user', id: user.id } : undefined,
      summary: `Failed sign-in for ${maskEmail(email)} (${reason})`,
      details: { email: maskEmail(email), reason },
    });
  }

  // Only the attempt that reaches a limit is audited, so a lock shows up once instead of once per refused try.
  private async countFailedSignIn(email: string, address: string, user: UserEntity | null): Promise<void> {
    const minutes = SIGN_IN_WINDOW_MS / 60000;
    if (this.failedSignInsByAccount.hit(email)) {
      await this.auditService.record({
        category: 'auth',
        action: 'LOGIN_LOCKED',
        outcome: 'denied',
        target: user ? { type: 'user', id: user.id } : undefined,
        summary: `Sign-in for ${maskEmail(email)} paused for ${minutes} minutes after ${FAILED_SIGN_INS_PER_ACCOUNT} failed attempts`,
        details: { email: maskEmail(email), scope: 'account' },
      });
    }
    if (this.failedSignInsByAddress.hit(address)) {
      await this.auditService.record({
        category: 'auth',
        action: 'LOGIN_LOCKED',
        outcome: 'denied',
        summary: `Sign-in from ${address} paused for ${minutes} minutes after ${FAILED_SIGN_INS_PER_ADDRESS} failed attempts`,
        details: { address, scope: 'address' },
      });
    }
  }

  async signup(dto: SignupRequestDto): Promise<AuthenticatedSession> {
    const address = currentRequestContext()?.ip ?? 'unknown';
    const wait = this.signUpsByAddress.blockedFor(address);
    if (wait > 0) throw new TooManyAttemptsException(`Too many sign-up attempts from your network. Try again ${waitDescription(wait)}.`, wait);
    this.signUpsByAddress.hit(address);

    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    const weakness = passwordProblem(dto.password);
    if (weakness) throw new BadRequestException(weakness);

    if (existing) {
      await this.auditService.record({
        category: 'auth',
        action: 'SIGNUP_FAILED',
        outcome: 'failure',
        summary: `Sign-up refused for ${maskEmail(normalizedEmail)} (email already registered)`,
        details: { email: maskEmail(normalizedEmail), reason: 'email already registered' },
      });
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.createAccount({
      email: normalizedEmail,
      password: await hashPassword(dto.password),
      // Self-service accounts are always employees; Helpdesk access is granted with `npm run user:role`.
      role: 'employee',
      firstName: dto.firstName,
      lastName: dto.lastName,
      jobTitle: dto.jobTitle,
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    await this.auditService.record({
      category: 'auth',
      action: 'SIGNUP',
      actor: user,
      target: { type: 'user', id: user.id },
      summary: `Created an employee account (user ${user.id})`,
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

  // Creates an account under the next free numeric ID (also used when administrators add people). Two sign-ups
  // at the same moment can pick the same ID: insert refuses the duplicate (save would silently overwrite the
  // other person's new account), and the later one takes the next ID instead.
  async createAccount(fields: NewAccount): Promise<UserEntity> {
    for (let attempt = 1; ; attempt += 1) {
      const id = await this.nextUserId();
      const user = { ...fields, id, employeeId: id } as UserEntity;
      try {
        await this.userRepository.insert(user);
        return user;
      } catch (error) {
        const duplicate = error instanceof QueryFailedError && /UNIQUE constraint failed/i.test(error.message);
        if (!duplicate || attempt === 5) throw error;
        if (await this.userRepository.findOneBy({ email: fields.email })) throw new ConflictException('An account with this email already exists');
      }
    }
  }

  // Next free numeric account ID.
  private async nextUserId(): Promise<string> {
    const users = await this.userRepository.find({ select: { id: true } });
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

    await this.userRepository.insert(
      await Promise.all(
        employees.map(async (employee) => ({
          ...employee,
          password: await hashPassword(employee.password),
          status: 'active' as const,
          createdAt: now,
        })),
      ),
    );
  }
}

function fullName(user: Pick<UserEntity, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
