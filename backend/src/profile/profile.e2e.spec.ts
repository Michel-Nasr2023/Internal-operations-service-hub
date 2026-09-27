import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../auth/user.entity';
import { TicketEntity } from '../tickets/ticket.entity';
import { PasswordResetTokenEntity } from '../auth/password-reset-token.entity';
import { OutboxEmailEntity } from '../mail/outbox-email.entity';
import { ProfileModule } from './profile.module';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);

describe('Profile API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const avatarsDir = mkdtempSync(join(tmpdir(), 'avatars-'));

  beforeAll(async () => {
    process.env.AVATARS_DIR = avatarsDir;
    const moduleFixture = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'sqlite', database: ':memory:', entities: [UserEntity, AuditLogEntity, TicketEntity, PasswordResetTokenEntity, OutboxEmailEntity], synchronize: true }),
        AuthModule,
        ProfileModule,
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
    rmSync(avatarsDir, { recursive: true, force: true });
    delete process.env.AVATARS_DIR;
  });

  async function login(email: string, password: string): Promise<Response> {
    return fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  }

  async function signUp(email: string, password: string): Promise<Response> {
    return fetch(`${baseUrl}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName: 'Jane', lastName: 'Doe', jobTitle: 'Analyst' }),
    });
  }

  async function tokenFor(email: string, password: string): Promise<string> {
    return ((await (await login(email, password)).json()) as { token: string }).token;
  }

  it('enforces the password rules at sign-up', async () => {
    expect((await signUp('weak@company.com', 'password')).status).toBe(400);
    expect((await signUp('jane@company.com', 'Str0ngPass')).status).toBe(201);
  });

  it('reads and updates only the signed-in user profile', async () => {
    const token = await tokenFor('jane@company.com', 'Str0ngPass');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const profile = (await (await fetch(`${baseUrl}/profile`, { headers: auth })).json()) as { email: string; firstName: string; avatarUpdatedAt: string | null };
    expect(profile).toMatchObject({ email: 'jane@company.com', firstName: 'Jane', avatarUpdatedAt: null });

    const updated = await fetch(`${baseUrl}/profile`, { method: 'PATCH', headers: auth, body: JSON.stringify({ firstName: '  Janet ', lastName: 'Doe', jobTitle: '' }) });
    expect(await updated.json()).toMatchObject({ firstName: 'Janet', lastName: 'Doe' });
    expect(((await (await fetch(`${baseUrl}/profile`, { headers: auth })).json()) as { jobTitle?: string }).jobTitle).toBeUndefined();

    // Role, email and other fields cannot be changed through the profile.
    const escalation = await fetch(`${baseUrl}/profile`, { method: 'PATCH', headers: auth, body: JSON.stringify({ firstName: 'J', lastName: 'D', role: 'helpdesk' }) });
    expect(escalation.status).toBe(400);
    expect((await fetch(`${baseUrl}/profile`)).status).toBe(401);
  });

  it('changes the password only with the correct current password and a strong new one', async () => {
    const token = await tokenFor('jane@company.com', 'Str0ngPass');
    const change = (body: object) =>
      fetch(`${baseUrl}/profile/password`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const wrongCurrent = await change({ currentPassword: 'nope', newPassword: 'N3wPassword' });
    expect(wrongCurrent.status).toBe(400);
    expect(((await wrongCurrent.json()) as { message: string }).message).toBe('Your current password is incorrect.');
    expect((await change({ currentPassword: 'Str0ngPass', newPassword: 'short1' })).status).toBe(400);
    expect((await change({ currentPassword: 'Str0ngPass', newPassword: 'Str0ngPass' })).status).toBe(400);

    expect((await change({ currentPassword: 'Str0ngPass', newPassword: 'N3wPassword' })).status).toBe(201);
    expect((await login('jane@company.com', 'Str0ngPass')).status).toBe(401);
    expect((await login('jane@company.com', 'N3wPassword')).status).toBe(201);

    const audit = await app.get(DataSource).getRepository(AuditLogEntity).find({ where: { targetType: 'user' } });
    expect(audit.filter((row) => row.action === 'PASSWORD_CHANGE_FAILED')).toHaveLength(3);
    expect(audit.some((row) => row.action === 'PASSWORD_CHANGED')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('N3wPassword');
  });

  it('stores a validated profile photo that colleagues can see, and removes it', async () => {
    const token = await tokenFor('jane@company.com', 'N3wPassword');
    const colleague = await tokenFor('helpdesk@company.com', 'helpdesk123');
    const upload = (name: string, bytes: Buffer) => {
      const form = new FormData();
      form.append('avatar', new Blob([new Uint8Array(bytes)]), name);
      return fetch(`${baseUrl}/profile/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };

    expect((await upload('me.gif', Buffer.from('GIF89a'))).status).toBe(400);
    expect((await upload('me.png', Buffer.from('<svg onload=alert(1)>'))).status).toBe(400);
    expect((await upload('me.png', Buffer.alloc(2 * 1024 * 1024 + 1))).status).toBe(413);

    const saved = (await (await upload('me.png', PNG_BYTES)).json()) as { id: string; avatarUpdatedAt: string };
    expect(saved.avatarUpdatedAt).toEqual(expect.any(String));

    const photo = await fetch(`${baseUrl}/users/${saved.id}/avatar`, { headers: { Authorization: `Bearer ${colleague}` } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(photo.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await photo.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

    const removed = await fetch(`${baseUrl}/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    expect(((await removed.json()) as { avatarUpdatedAt: string | null }).avatarUpdatedAt).toBeNull();
    expect((await fetch(`${baseUrl}/users/${saved.id}/avatar`, { headers: { Authorization: `Bearer ${colleague}` } })).status).toBe(404);
  });
});
