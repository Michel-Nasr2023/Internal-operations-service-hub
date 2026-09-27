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
    const employeeFailure = rows.find((row) => row.details?.email === 'employee@company.com');
    const unknownFailure = rows.find((row) => row.details?.email === 'nobody@company.com');
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
});
