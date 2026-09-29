import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { PasswordResetTokenEntity } from '../auth/password-reset-token.entity';
import { UserEntity } from '../auth/user.entity';
import { OutboxEmailEntity } from '../mail/outbox-email.entity';
import { ProfileModule } from '../profile/profile.module';
import { TicketEntity } from '../tickets/ticket.entity';
import { AdminModule } from './admin.module';
import { NotificationEntity } from '../notifications/notification.entity';
import { TicketAttachmentEntity } from '../tickets/ticket-attachment.entity';
import { TicketCommentEntity } from '../tickets/ticket-comment.entity';
import { TicketViewEntity } from '../tickets/ticket-view.entity';
import { TicketStatus } from '../tickets/ticket.types';

describe('Password reset and administration (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [
            UserEntity,
            AuditLogEntity,
            TicketEntity,
            PasswordResetTokenEntity,
            OutboxEmailEntity,
            NotificationEntity,
            TicketCommentEntity,
            TicketViewEntity,
            TicketAttachmentEntity,
          ],
          synchronize: true,
        }),
        AuthModule,
        ProfileModule,
        AdminModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    await app.close();
  });

  function post(path: string, body: object, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  }

  function patch(path: string, body: object, token: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  }

  async function signIn(email: string, password: string): Promise<string> {
    const response = await post('/auth/login', { email, password });
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  }

  async function outboxFor(email: string): Promise<OutboxEmailEntity[]> {
    return app.get(DataSource).getRepository(OutboxEmailEntity).find({ where: { to: email }, order: { createdAt: 'ASC' } });
  }

  function linkToken(body: string): string {
    return body.match(/\?reset=([A-Za-z0-9_-]+)/)![1];
  }

  it('resets a forgotten password with a single-use link and signs out old sessions', async () => {
    const oldSession = await signIn('employee@company.com', 'employee123');

    const unknown = await post('/auth/forgot-password', { email: 'nobody@company.com' });
    const known = await post('/auth/forgot-password', { email: 'employee@company.com' });
    expect(await unknown.json()).toEqual(await known.json());
    expect(await outboxFor('nobody@company.com')).toHaveLength(0);

    const [email] = await outboxFor('employee@company.com');
    expect(email.subject).toMatch(/^\d{6} is your password reset code$/);
    const token = linkToken(email.body);
    expect(await app.get(DataSource).getRepository(PasswordResetTokenEntity).findOneBy({ tokenHash: token })).toBeNull();

    expect(await (await post('/auth/reset-password/check', { token })).json()).toMatchObject({ valid: true, purpose: 'reset', email: 'em******@company.com' });
    expect((await post('/auth/reset-password', { token, newPassword: 'short' })).status).toBe(400);
    expect((await post('/auth/reset-password', { token, newPassword: 'Brand1New' })).status).toBe(201);

    expect((await post('/auth/reset-password', { token, newPassword: 'Another2One' })).status).toBe(400);
    expect((await post('/auth/login', { email: 'employee@company.com', password: 'employee123' })).status).toBe(401);
    await signIn('employee@company.com', 'Brand1New');
    expect((await fetch(`${baseUrl}/profile`, { headers: { Authorization: `Bearer ${oldSession}` } })).status).toBe(401);
  });

  it('resets a password with the 6-digit code from the email, and cancels after too many wrong codes', async () => {
    await app.get(DataSource).getRepository(UserEntity).save({
      id: 'coder-1', email: 'coder@company.com', password: 'x', role: 'employee', firstName: 'Cody', lastName: 'Der', status: 'active', createdAt: new Date().toISOString(),
    });
    const codeFrom = async () => (await outboxFor('coder@company.com')).at(-1)!.body.match(/reset code is: (\d{6})/)![1];
    const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

    await post('/auth/forgot-password', { email: 'coder@company.com' });
    const code = await codeFrom();
    expect((await post('/auth/reset-password/verify-code', { email: 'coder@company.com', code: wrongCode(code) })).status).toBe(400);
    expect((await post('/auth/reset-password/verify-code', { email: 'nobody@company.com', code })).status).toBe(400);
    expect(await (await post('/auth/reset-password/verify-code', { email: 'coder@company.com', code: `${code.slice(0, 3)} ${code.slice(3)}` })).json()).toEqual({ valid: true });

    expect((await post('/auth/reset-password', { email: 'coder@company.com', code, newPassword: 'Coded1234' })).status).toBe(201);
    await signIn('coder@company.com', 'Coded1234');
    expect((await post('/auth/reset-password', { email: 'coder@company.com', code, newPassword: 'Again1234' })).status).toBe(400);

    await post('/auth/forgot-password', { email: 'coder@company.com' });
    const second = await codeFrom();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post('/auth/reset-password/verify-code', { email: 'coder@company.com', code: wrongCode(second) });
    }
    expect((await post('/auth/reset-password/verify-code', { email: 'coder@company.com', code: second })).status).toBe(400);
    expect(await app.get(DataSource).getRepository(AuditLogEntity).countBy({ action: 'PASSWORD_RESET_FAILED', targetId: 'coder-1' })).toBe(6);
  });

  it('limits reset emails to three an hour per account', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await post('/auth/forgot-password', { email: 'helpdesk@company.com' });
    expect(await outboxFor('helpdesk@company.com')).toHaveLength(3);
  });

  it('gives administrators full user management with safeguards, applied immediately', async () => {
    const admin = await signIn('admin@company.com', 'Admin12345');
    const employee = await signIn('employee@company.com', 'Brand1New');
    expect((await fetch(`${baseUrl}/admin/users`, { headers: { Authorization: `Bearer ${employee}` } })).status).toBe(403);

    const overview = (await (await fetch(`${baseUrl}/admin/overview`, { headers: { Authorization: `Bearer ${admin}` } })).json()) as { users: { byRole: Record<string, number> } };
    expect(overview.users.byRole).toMatchObject({ employee: 2, helpdesk: 1, administrator: 1 });

    // Create: the new person sets their own password from the invitation.
    const created = await post('/admin/users', { email: 'Sam@Company.com', firstName: 'Sam', lastName: 'Reed', role: 'employee' }, admin);
    const sam = (await created.json()) as { id: string; email: string; status: string };
    expect(created.status).toBe(201);
    expect(sam).toMatchObject({ email: 'sam@company.com', status: 'active' });
    const [invite] = await outboxFor('sam@company.com');
    expect(invite.purpose).toBe('account-invite');
    await post('/auth/reset-password', { token: linkToken(invite.body), newPassword: 'SamPass123' });
    const samSession = await signIn('sam@company.com', 'SamPass123');

    // A role change ends the old session immediately.
    expect((await patch(`/admin/users/${sam.id}`, { role: 'helpdesk' }, admin)).status).toBe(200);
    const stale = await fetch(`${baseUrl}/profile`, { headers: { Authorization: `Bearer ${samSession}` } });
    expect(stale.status).toBe(401);
    expect(((await stale.json()) as { message: string }).message).toContain('role has changed');
    expect(((await (await fetch(`${baseUrl}/profile`, { headers: { Authorization: `Bearer ${await signIn('sam@company.com', 'SamPass123')}` } })).json()) as { role: string }).role).toBe('helpdesk');

    // Disabling blocks sign-in; administrators cannot lock themselves out.
    expect((await patch(`/admin/users/${sam.id}`, { status: 'disabled' }, admin)).status).toBe(200);
    expect((await post('/auth/login', { email: 'sam@company.com', password: 'SamPass123' })).status).toBe(401);
    expect((await patch('/admin/users/admin-1', { status: 'disabled' }, admin)).status).toBe(400);
    expect((await patch('/admin/users/admin-1', { role: 'employee' }, admin)).status).toBe(400);
    expect((await post('/admin/users', { email: 'sam@company.com', firstName: 'X', lastName: 'Y', role: 'employee' }, admin)).status).toBe(409);

    // Sign out everywhere.
    const employeeAgain = await signIn('employee@company.com', 'Brand1New');
    expect((await post('/admin/users/employee-1/sign-out', {}, admin)).status).toBe(201);
    expect((await fetch(`${baseUrl}/profile`, { headers: { Authorization: `Bearer ${employeeAgain}` } })).status).toBe(401);

    const actions = (await app.get(DataSource).getRepository(AuditLogEntity).find()).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['USER_CREATED', 'USER_INVITED', 'INVITE_ACCEPTED', 'USER_ROLE_CHANGED', 'USER_DISABLED', 'USER_SESSIONS_REVOKED']));
  });

  it('requires handing over active tickets before disabling someone, then reassigns or returns them', async () => {
    const admin = await signIn('admin@company.com', 'Admin12345');
    const data = app.get(DataSource);
    const now = new Date().toISOString();
    await data.getRepository(UserEntity).save([
      { id: 'leaver-1', email: 'leaver@company.com', password: 'x', role: 'employee', firstName: 'Lee', lastName: 'Ver', status: 'active', createdAt: now },
      { id: 'taker-1', email: 'taker@company.com', password: 'x', role: 'employee', firstName: 'Tia', lastName: 'Ker', status: 'active', createdAt: now },
    ]);
    const ticket = (id: string, status: TicketStatus, extra: object = {}) => ({
      id,
      requesterId: 'employee-1',
      teamId: 'it',
      issueType: 'hardware',
      project: 'Office',
      title: `Ticket ${id}`,
      description: 'Broken',
      status,
      priority: 'high',
      assigneeId: 'leaver-1',
      assignedAt: now,
      expectedDurationHours: 4,
      createdAt: now,
      updatedAt: now,
      version: 1,
      auditEvents: [],
      ...extra,
    });
    await data.getRepository(TicketEntity).save([
      ticket('t-assigned', TicketStatus.ASSIGNED, { aiResult: { source: 'pending', requestedAt: now } }),
      ticket('t-working', TicketStatus.IN_PROGRESS, { claimedAt: now, dueAt: now }),
      ticket('t-done', TicketStatus.RESOLVED, { resolvedAt: now, aiResult: { source: 'failed', failureCode: 'timeout', failureReason: 'Slow', attempts: 1, generatedAt: now } }),
    ] as TicketEntity[]);

    // The figures on the admin pages are counted by the database; they must match what was just stored.
    const read = async (path: string) => (await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${admin}` } })).json();
    const people = (await read('/admin/users')) as Array<{ id: string; activeAssignments: number; openRequests: number }>;
    expect(people.find((person) => person.id === 'leaver-1')).toMatchObject({ activeAssignments: 2, openRequests: 0 });
    expect(people.find((person) => person.id === 'employee-1')).toMatchObject({ activeAssignments: 0, openRequests: 2 });
    expect(((await read('/admin/overview')) as { tickets: object }).tickets).toMatchObject({
      total: 3,
      open: 2,
      overdue: 1,
      unassignedApproved: 0,
      aiPending: 1,
      aiFailed: 1,
      byStatus: { [TicketStatus.ASSIGNED]: 1, [TicketStatus.IN_PROGRESS]: 1, [TicketStatus.RESOLVED]: 1 },
    });
    expect(((await read('/admin/system')) as { ai: object }).ai).toMatchObject({ pending: 1, failed: 1 });

    const blocked = await patch('/admin/users/leaver-1', { status: 'disabled' }, admin);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { message: string }).message).toContain('still has 2 active tickets');
    expect((await patch('/admin/users/leaver-1', { role: 'helpdesk' }, admin)).status).toBe(409);

    expect((await post('/admin/users/leaver-1/handover', { mode: 'reassign', toUserId: 'helpdesk-1' }, admin)).status).toBe(400);
    expect((await post('/admin/users/leaver-1/handover', { mode: 'reassign' }, admin)).status).toBe(400);

    const handover = await post('/admin/users/leaver-1/handover', { mode: 'reassign', toUserId: 'taker-1' }, admin);
    expect(await handover.json()).toMatchObject({ moved: 2, message: '2 tickets handed over to Tia Ker.' });

    const moved = await data.getRepository(TicketEntity).findBy({ assigneeId: 'taker-1' });
    expect(moved.map((item) => [item.id, item.status, item.claimedAt ?? null, item.dueAt ?? null]).sort()).toEqual([
      ['t-assigned', TicketStatus.ASSIGNED, null, null],
      ['t-working', TicketStatus.ASSIGNED, null, null],
    ]);
    const working = moved.find((item) => item.id === 't-working')!;
    expect(working.auditEvents.at(-1)).toMatchObject({ action: 'TICKET_REASSIGNED', oldStatus: TicketStatus.IN_PROGRESS, reason: 'handover from Lee Ver' });
    expect((await data.getRepository(TicketEntity).findOneBy({ id: 't-done' }))?.assigneeId).toBe('leaver-1');
    expect(await data.getRepository(NotificationEntity).countBy({ recipientId: 'taker-1', kind: 'ticket-assigned' })).toBe(2);

    expect((await patch('/admin/users/leaver-1', { status: 'disabled' }, admin)).status).toBe(200);

    // Returning to the queue leaves the ticket approved and unassigned for Helpdesk.
    const back = await post('/admin/users/taker-1/handover', { mode: 'queue' }, admin);
    expect(await back.json()).toMatchObject({ moved: 2 });
    const returned = await data.getRepository(TicketEntity).findOneBy({ id: 't-working' });
    expect(returned).toMatchObject({ status: TicketStatus.APPROVED, assigneeId: null, assignedAt: null, expectedDurationHours: null });
    expect(returned?.auditEvents.at(-1)).toMatchObject({ action: 'TICKET_RETURNED_TO_QUEUE', newStatus: TicketStatus.APPROVED });
  });
});
