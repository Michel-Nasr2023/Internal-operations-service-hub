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

describe('Password reset and administration (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [UserEntity, AuditLogEntity, TicketEntity, PasswordResetTokenEntity, OutboxEmailEntity],
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
    expect(email.subject).toContain('Reset your');
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

  it('limits reset emails to three an hour per account', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await post('/auth/forgot-password', { email: 'helpdesk@company.com' });
    expect(await outboxFor('helpdesk@company.com')).toHaveLength(3);
  });

  it('gives administrators full user management with safeguards, applied immediately', async () => {
    const admin = await signIn('admin@company.com', 'Admin12345');
    const employee = await signIn('employee@company.com', 'Brand1New');
    expect((await fetch(`${baseUrl}/admin/users`, { headers: { Authorization: `Bearer ${employee}` } })).status).toBe(403);

    const overview = (await (await fetch(`${baseUrl}/admin/overview`, { headers: { Authorization: `Bearer ${admin}` } })).json()) as { users: { byRole: Record<string, number> } };
    expect(overview.users.byRole).toMatchObject({ employee: 1, helpdesk: 1, administrator: 1 });

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
});
