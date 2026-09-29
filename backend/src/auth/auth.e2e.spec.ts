import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressInfo } from 'node:net';
import { AuthModule } from './auth.module';
import { UserEntity } from './user.entity';
import { verifyToken } from './token';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { TicketEntity } from '../tickets/ticket.entity';
import { PasswordResetTokenEntity } from './password-reset-token.entity';
import { OutboxEmailEntity } from '../mail/outbox-email.entity';

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [UserEntity, AuditLogEntity, TicketEntity, PasswordResetTokenEntity, OutboxEmailEntity],
          synchronize: true,
        }),
        AuthModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in an employee and a helpdesk user with their role', async () => {
    const employeeLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'employee@company.com', password: 'employee123' }),
    });

    const employee = (await employeeLogin.json()) as { id: string; role: string; email: string };

    expect(employeeLogin.status).toBe(201);
    expect(employee.role).toBe('employee');
    expect(employee.email).toBe('employee@company.com');

    const helpdeskLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helpdesk@company.com', password: 'helpdesk123' }),
    });

    const helpdesk = (await helpdeskLogin.json()) as { id: string; role: string; email: string };

    expect(helpdeskLogin.status).toBe(201);
    expect(helpdesk.role).toBe('helpdesk');
    expect(helpdesk.email).toBe('helpdesk@company.com');
  });

  it('stores hashed passwords and issues a token carrying the user role', async () => {
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helpdesk@company.com', password: 'helpdesk123' }),
    });
    const session = (await login.json()) as { token: string };
    const stored = await app.get(DataSource).getRepository(UserEntity).findOneByOrFail({ email: 'helpdesk@company.com' });

    expect(stored.password).not.toBe('helpdesk123');
    expect(stored.password.startsWith('scrypt$')).toBe(true);
    expect(verifyToken(session.token)).toMatchObject({ id: 'helpdesk-1', role: 'helpdesk', issuedAt: expect.any(Number) });

    const wrongPassword = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helpdesk@company.com', password: 'wrong' }),
    });
    expect(wrongPassword.status).toBe(401);
  });

  it('always creates employees through public signup and refuses a requested role', async () => {
    const account = { email: 'new.person@company.com', password: 'secret123', firstName: 'New', lastName: 'Person' };

    const escalation = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...account, role: 'helpdesk' }),
    });
    expect(escalation.status).toBe(400);

    const signup = await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    });
    const created = (await signup.json()) as { role: string; token: string };

    expect(signup.status).toBe(201);
    expect(created.role).toBe('employee');
    expect(verifyToken(created.token)?.role).toBe('employee');
  });

  it('audits successful and failed sign-ins without storing the password', async () => {
    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'jest-audit-test' },
      body: JSON.stringify({ email: 'employee@company.com', password: 'not-the-password' }),
    });
    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@company.com', password: 'secret-guess' }),
    });

    const rows = await app.get(DataSource).getRepository(AuditLogEntity).find({ where: { action: 'LOGIN_FAILED' }, order: { timestamp: 'ASC' } });
    // Emails are masked in the log: enough to recognise the account, not the full address.
    const employeeFailure = rows.find((row) => row.details?.email === 'em******@company.com');
    const unknownFailure = rows.find((row) => row.details?.email === 'no****@company.com');
    expect(employeeFailure).toMatchObject({ category: 'auth', outcome: 'failure', targetId: 'employee-1', userAgent: 'jest-audit-test' });
    expect(employeeFailure?.details?.reason).toBe('wrong password');
    expect(employeeFailure?.requestId).toEqual(expect.any(String));
    expect(unknownFailure?.details?.reason).toBe('unknown email');
    expect(unknownFailure?.targetId).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('not-the-password');
    expect(JSON.stringify(rows)).not.toContain('secret-guess');

    const succeeded = await app.get(DataSource).getRepository(AuditLogEntity).findBy({ action: 'LOGIN_SUCCEEDED' });
    expect(succeeded.length).toBeGreaterThan(0);
  });

  it('gives people who sign up at the same moment their own accounts', async () => {
    const emails = ['twin1@company.com', 'twin2@company.com', 'twin3@company.com'];
    const responses = await Promise.all(
      emails.map((email, index) =>
        fetch(`${baseUrl}/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'TwinPass123', firstName: 'Twin', lastName: String(index + 1) }),
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);

    const accounts = (await Promise.all(responses.map((response) => response.json()))) as Array<{ id: string; email: string }>;
    expect(new Set(accounts.map((account) => account.id)).size).toBe(3);
    const stored = await app.get(DataSource).getRepository(UserEntity).find();
    for (const account of accounts) expect(stored.find((user) => user.id === account.id)?.email).toBe(account.email);
  });

  it('pauses sign-in for an account after 5 wrong passwords, without affecting other accounts', async () => {
    await fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'target@company.com', password: 'RightPass123', firstName: 'Tara', lastName: 'Get' }),
    });
    const signIn = (email: string, password: string) =>
      fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await signIn('target@company.com', `wrong-guess-${attempt}`)).status).toBe(401);
    }

    // Even the right password waits now, so guessing cannot continue.
    const locked = await signIn('target@company.com', 'RightPass123');
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(800);
    expect(((await locked.json()) as { message: string }).message).toContain('Try again in 15 minutes');

    expect((await signIn('employee@company.com', 'employee123')).status).toBe(201);

    const locks = await app.get(DataSource).getRepository(AuditLogEntity).findBy({ action: 'LOGIN_LOCKED' });
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ outcome: 'denied', summary: expect.stringContaining('ta****@company.com') });
    expect(JSON.stringify(await app.get(DataSource).getRepository(AuditLogEntity).find())).not.toContain('target@company.com');
  });
});
