import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { In, LessThanOrEqual, MoreThan, Not, Repository } from 'typeorm';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { PasswordResetService } from '../auth/password-reset.service';
import { UserEntity } from '../auth/user.entity';
import { MailService } from '../mail/mail.service';
import { TicketEntity } from '../tickets/ticket.entity';
import { AuthenticatedUser, TicketStatus, UserRole } from '../tickets/ticket.types';
import { AdminUserQueryDto, CreateUserDto, HandoverDto, UpdateUserDto } from './admin.dto';
import { TicketsService } from '../tickets/tickets.service';

export interface AdminUserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  role: UserRole;
  status: 'active' | 'disabled';
  employeeId?: string;
  avatarUpdatedAt: string | null;
  createdAt: string;
  passwordChangedAt: string | null;
  lastSignInAt: string | null;
  activeAssignments: number;
  openRequests: number;
}

const ROLE_NAMES: Record<string, string> = { employee: 'Employee', helpdesk: 'Helpdesk', administrator: 'Administrator', assignee: 'Assignee' };

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(AuditLogEntity) private readonly auditRepository: Repository<AuditLogEntity>,
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly ticketsService: TicketsService,
  ) {}

  // Ticket figures are counted by the database rather than by loading every ticket.
  async overview() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const [users, byStatus, overdue, ai, failedSignIns, deniedRequests, recentSecurity] = await Promise.all([
      this.userRepository.find({ select: { role: true, status: true } }),
      this.ticketsByStatus(),
      this.ticketRepository.count({ where: { status: TicketStatus.IN_PROGRESS, dueAt: LessThanOrEqual(now.toISOString()) } }),
      this.aiAnalysisCounts(),
      this.auditRepository.count({ where: { action: 'LOGIN_FAILED', timestamp: MoreThan(dayAgo) } }),
      this.auditRepository.count({ where: { category: 'access', timestamp: MoreThan(dayAgo) } }),
      this.auditRepository.find({ where: { outcome: Not('success'), category: In(['auth', 'access']) }, order: { timestamp: 'DESC' }, take: 8 }),
    ]);
    const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);

    return {
      users: {
        total: users.length,
        active: users.filter((user) => user.status === 'active').length,
        disabled: users.filter((user) => user.status !== 'active').length,
        byRole: users.reduce<Record<string, number>>((totals, user) => ({ ...totals, [user.role]: (totals[user.role] ?? 0) + 1 }), {}),
      },
      tickets: {
        total,
        byStatus,
        open: total - (byStatus[TicketStatus.RESOLVED] ?? 0) - (byStatus[TicketStatus.REJECTED] ?? 0),
        overdue,
        unassignedApproved: byStatus[TicketStatus.APPROVED] ?? 0,
        aiPending: ai.pending,
        aiFailed: ai.failed,
      },
      security: { failedSignIns24h: failedSignIns, deniedRequests24h: deniedRequests, recent: await this.auditService.withActorNames(recentSecurity) },
    };
  }

  private async ticketsByStatus(): Promise<Record<string, number>> {
    const rows = await this.ticketRepository
      .createQueryBuilder('ticket')
      .select('ticket.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ticket.status')
      .getRawMany<{ status: string; count: number | string }>();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  // AI analyses still running or failed; the source is read from the stored JSON by the database.
  private async aiAnalysisCounts(): Promise<{ pending: number; failed: number }> {
    const rows = await this.ticketRepository
      .createQueryBuilder('ticket')
      .select("json_extract(ticket.aiResult, '$.source')", 'source')
      .addSelect('COUNT(*)', 'count')
      .groupBy('source')
      .getRawMany<{ source: string | null; count: number | string }>();
    const count = (source: string) => Number(rows.find((row) => row.source === source)?.count ?? 0);
    return { pending: count('pending'), failed: count('failed') };
  }

  async listUsers(query: AdminUserQueryDto): Promise<AdminUserView[]> {
    const users = await this.userRepository.find({
      where: { ...(query.role ? { role: query.role } : {}), ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'ASC' },
    });
    const term = query.search?.trim().toLowerCase();
    const matching = term
      ? users.filter((user) => `${user.firstName} ${user.lastName} ${user.email} ${user.jobTitle ?? ''} ${user.employeeId ?? ''}`.toLowerCase().includes(term))
      : users;
    return this.present(matching);
  }

  // The new person receives an invitation link to set their own password; the admin never sees or sets it.
  async createUser(dto: CreateUserDto, admin: AuthenticatedUser): Promise<AdminUserView> {
    const email = dto.email.toLowerCase();
    if (await this.userRepository.findOneBy({ email })) throw new ConflictException('An account with this email already exists');

    const user = await this.authService.createAccount({
      email,
      // Unusable until the invitation is accepted.
      password: await hashPassword(randomBytes(32).toString('hex')),
      role: dto.role,
      firstName: dto.firstName,
      lastName: dto.lastName,
      jobTitle: dto.jobTitle || undefined,
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    await this.auditService.record({
      category: 'auth',
      action: 'USER_CREATED',
      actor: admin,
      target: { type: 'user', id: user.id },
      summary: `Created ${ROLE_NAMES[dto.role]} account for ${dto.firstName} ${dto.lastName} (${email})`,
      details: { role: dto.role },
    });
    await this.passwordResetService.issue(user, 'invite', admin);
    return (await this.present([user]))[0];
  }

  async updateUser(id: string, dto: UpdateUserDto, admin: AuthenticatedUser): Promise<AdminUserView> {
    const user = await this.load(id);
    const isSelf = user.id === admin.id;
    const roleChanged = dto.role !== undefined && dto.role !== user.role;
    const statusChanged = dto.status !== undefined && dto.status !== user.status;

    if (isSelf && (roleChanged || statusChanged)) {
      throw new BadRequestException('You cannot change your own role or disable your own account. Ask another administrator.');
    }
    const losesAdmin = user.role === 'administrator' && user.status === 'active' && ((roleChanged && dto.role !== 'administrator') || dto.status === 'disabled');
    if (losesAdmin && (await this.userRepository.count({ where: { role: 'administrator', status: 'active' } })) <= 1) {
      throw new BadRequestException('There must always be at least one active administrator.');
    }
    // Nobody may be left holding tickets they can no longer work on: hand them over first.
    const stopsWorkingTickets = dto.status === 'disabled' || (roleChanged && dto.role === 'helpdesk');
    if (stopsWorkingTickets) {
      const held = await this.ticketsService.countActiveAssignments(user.id);
      if (held > 0) {
        throw new ConflictException(
          `${user.firstName} ${user.lastName} still has ${held} active ticket${held === 1 ? '' : 's'}. Hand them over to someone else or back to the Helpdesk queue first.`,
        );
      }
    }

    const email = dto.email?.toLowerCase();
    if (email && email !== user.email && (await this.userRepository.findOneBy({ email }))) {
      throw new ConflictException('Another account already uses this email');
    }

    const changes: Partial<UserEntity> = {};
    const changed: string[] = [];
    const set = <K extends keyof UserEntity>(field: K, value: UserEntity[K] | undefined, label: string) => {
      if (value !== undefined && value !== user[field]) {
        changes[field] = value;
        changed.push(label);
      }
    };
    set('firstName', dto.firstName, 'first name');
    set('lastName', dto.lastName, 'last name');
    set('email', email, 'email');
    set('role', dto.role, 'role');
    set('status', dto.status, 'status');
    if (dto.jobTitle !== undefined && (dto.jobTitle || null) !== (user.jobTitle ?? null)) {
      changes.jobTitle = (dto.jobTitle || null) as string | undefined;
      changed.push('job title');
    }
    if (changed.length === 0) return (await this.present([user]))[0];

    // A new role or a disabled account applies immediately: their current sessions stop working.
    if (roleChanged || statusChanged) changes.sessionsRevokedAt = new Date().toISOString();
    await this.userRepository.update({ id }, changes);

    const name = `${changes.firstName ?? user.firstName} ${changes.lastName ?? user.lastName}`;
    const action = statusChanged ? (dto.status === 'disabled' ? 'USER_DISABLED' : 'USER_ENABLED') : roleChanged ? 'USER_ROLE_CHANGED' : 'USER_UPDATED';
    const summary = statusChanged
      ? `${dto.status === 'disabled' ? 'Disabled' : 'Re-enabled'} the account of ${name}`
      : roleChanged
        ? `Changed ${name}'s role from ${ROLE_NAMES[user.role]} to ${ROLE_NAMES[dto.role!]}`
        : `Updated ${name}'s ${changed.join(', ')}`;
    await this.auditService.record({
      category: 'auth',
      action,
      actor: admin,
      target: { type: 'user', id },
      summary,
      details: { fields: changed.join(', '), ...(roleChanged ? { from: user.role, to: dto.role } : {}) },
    });
    return (await this.present([await this.load(id)]))[0];
  }

  async handOver(id: string, dto: HandoverDto, admin: AuthenticatedUser): Promise<{ moved: number; message: string }> {
    const user = await this.load(id);
    if (dto.mode === 'reassign' && !dto.toUserId) throw new BadRequestException('Choose who should take over the tickets');

    const recipient = dto.mode === 'reassign' ? await this.userRepository.findOneBy({ id: dto.toUserId }) : null;
    const reason = `handover from ${user.firstName} ${user.lastName}`;
    const { moved } = await this.ticketsService.handOverAssignments(
      user.id,
      dto.mode === 'reassign' ? { mode: 'reassign', toUserId: dto.toUserId! } : { mode: 'queue' },
      admin,
      reason,
    );

    const destination = recipient ? `${recipient.firstName} ${recipient.lastName}` : 'the Helpdesk queue';
    if (moved > 0) {
      await this.auditService.record({
        category: 'ticket',
        action: 'TICKETS_HANDED_OVER',
        actor: admin,
        target: { type: 'user', id: user.id },
        summary: `Handed over ${moved} ticket${moved === 1 ? '' : 's'} from ${user.firstName} ${user.lastName} to ${destination}`,
        details: { moved, mode: dto.mode, toUserId: dto.toUserId ?? null },
      });
    }
    return {
      moved,
      message: moved === 0 ? `${user.firstName} ${user.lastName} has no active tickets.` : `${moved} ticket${moved === 1 ? '' : 's'} handed over to ${destination}.`,
    };
  }

  async sendPasswordReset(id: string, admin: AuthenticatedUser): Promise<{ message: string }> {
    const user = await this.load(id);
    if (user.status !== 'active') throw new ConflictException('Enable the account before sending a reset link');
    await this.passwordResetService.issue(user, 'reset', admin);
    return { message: `A password reset link was sent to ${user.email}.` };
  }

  async signOutEverywhere(id: string, admin: AuthenticatedUser): Promise<{ message: string }> {
    const user = await this.load(id);
    if (user.id === admin.id) throw new BadRequestException('Use Log out to end your own session.');
    await this.userRepository.update({ id }, { sessionsRevokedAt: new Date().toISOString() });
    await this.auditService.record({
      category: 'auth',
      action: 'USER_SESSIONS_REVOKED',
      actor: admin,
      target: { type: 'user', id },
      summary: `Signed ${user.firstName} ${user.lastName} out of all sessions`,
    });
    return { message: `${user.firstName} ${user.lastName} has been signed out everywhere.` };
  }

  outbox() {
    return this.mailService.listOutbox(50);
  }

  async system() {
    const started = Date.now();
    const ai = await this.aiAnalysisCounts();
    const databaseMs = Date.now() - started;
    return {
      database: { ok: true, responseMs: databaseMs },
      ai: {
        configured: !!process.env.RQSTY_API_KEY,
        model: process.env.RQSTY_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b',
        pending: ai.pending,
        failed: ai.failed,
      },
      authSecretConfigured: !!process.env.AUTH_SECRET,
      email: await this.mailService.status(),
      notificationCheckIntervalMs: Number(process.env.NOTIFICATION_CHECK_INTERVAL_MS ?? 5 * 60 * 1000),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
    };
  }

  private async load(id: string): Promise<UserEntity> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async present(users: UserEntity[]): Promise<AdminUserView[]> {
    const ids = users.map((user) => user.id);
    if (ids.length === 0) return [];

    const lastSignIns = await this.auditRepository
      .createQueryBuilder('entry')
      .select('entry.actorId', 'actorId')
      .addSelect('MAX(entry.timestamp)', 'last')
      .where('entry.action = :action', { action: 'LOGIN_SUCCEEDED' })
      .andWhere('entry.actorId IN (:...ids)', { ids })
      .groupBy('entry.actorId')
      .getRawMany<{ actorId: string; last: string }>();
    const lastSignIn = new Map(lastSignIns.map((row) => [row.actorId, row.last]));

    // Counted per person by the database, for the listed people only.
    const countFor = async (column: 'assigneeId' | 'requesterId', statusCondition: string, statuses: TicketStatus[]) => {
      const rows = await this.ticketRepository
        .createQueryBuilder('ticket')
        .select(`ticket.${column}`, 'userId')
        .addSelect('COUNT(*)', 'count')
        .where(`ticket.${column} IN (:...ids)`, { ids })
        .andWhere(`ticket.status ${statusCondition} (:...statuses)`, { statuses })
        .groupBy(`ticket.${column}`)
        .getRawMany<{ userId: string; count: number | string }>();
      return new Map(rows.map((row) => [row.userId, Number(row.count)]));
    };
    const [activeAssignments, openRequests] = await Promise.all([
      countFor('assigneeId', 'IN', [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS]),
      countFor('requesterId', 'NOT IN', [TicketStatus.RESOLVED, TicketStatus.REJECTED]),
    ]);

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: user.jobTitle ?? undefined,
      role: user.role,
      status: user.status,
      employeeId: user.employeeId,
      avatarUpdatedAt: user.avatarUpdatedAt ?? null,
      createdAt: user.createdAt,
      passwordChangedAt: user.passwordChangedAt ?? null,
      lastSignInAt: lastSignIn.get(user.id) ?? null,
      activeAssignments: activeAssignments.get(user.id) ?? 0,
      openRequests: openRequests.get(user.id) ?? 0,
    }));
  }
}
