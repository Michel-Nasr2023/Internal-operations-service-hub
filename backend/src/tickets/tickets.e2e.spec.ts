import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { TypeOrmModule } from '@nestjs/typeorm';
import { INestApplication } from '@nestjs/common';
import { TicketsModule } from './tickets.module';
import { RqstyAiService } from '../ai/rqsty-ai.service';
import { TicketAnalysisQueue } from './ticket-analysis.queue';
import { TicketEntity } from './ticket.entity';
import { Priority, TicketStatus, UserRole } from './ticket.types';
import { signToken } from '../auth/token';
import { UserEntity } from '../auth/user.entity';
import { NotificationEntity } from '../notifications/notification.entity';
import { TicketCommentEntity } from './ticket-comment.entity';
import { TicketViewEntity } from './ticket-view.entity';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { TicketAttachmentEntity } from './ticket-attachment.entity';
import { DataSource } from 'typeorm';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The AI provider is replaced with a stub here: the real provider is slow and rate-limited, and its
// parsing, retries and failure handling are covered in rqsty-ai.service.spec.ts.
jest.setTimeout(20000);

describe('Tickets API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  // Uploaded files go to a throwaway folder, never the real data/attachments.
  const attachmentsDir = mkdtempSync(join(tmpdir(), 'ticket-attachments-'));

  beforeAll(async () => {
    process.env.ATTACHMENTS_DIR = attachmentsDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [TicketEntity, UserEntity, NotificationEntity, TicketCommentEntity, TicketViewEntity, AuditLogEntity, TicketAttachmentEntity],
          synchronize: true,
        }),
        TicketsModule,
      ],
    })
      .overrideProvider(RqstyAiService)
      .useValue({
        analyzeTicket: async () => ({
          source: 'ai',
          summary: 'Laptop cannot join office Wi-Fi',
          clarifiedDescription: 'The employee reports that their laptop cannot connect to the office Wi-Fi.',
          issueType: 'network',
          severity: 'medium',
          recommendedAction: 'Check the laptop Wi-Fi profile and certificates.',
          missingInformation: ['Which network name is shown?'],
          isUnclear: false,
          generatedAt: new Date().toISOString(),
        }),
      })
      .compile();

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
    rmSync(attachmentsDir, { recursive: true, force: true });
    delete process.env.ATTACHMENTS_DIR;
  });

  async function request(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, options);
  }

  function identity(id: string, role: UserRole): HeadersInit {
    return { Authorization: `Bearer ${signToken({ id, role })}` };
  }

  it('creates a ticket immediately and adds the AI analysis in the background', async () => {
    const createResponse = await request('/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity('employee-1', 'employee') },
      body: JSON.stringify({
        title: 'Laptop cannot connect to Wi-Fi',
        description: 'The issue affects the office connection.',
        teamId: 'it',
        issueType: 'hardware',
        project: 'Office network',
      }),
    });
    const created = (await createResponse.json()) as { id: string; status: TicketStatus; aiResult: { source: string } };

    expect(createResponse.status).toBe(201);
    expect(created.status).toBe(TicketStatus.PENDING_HELPDESK_REVIEW);
    expect(created.aiResult.source).toBe('pending');

    await app.get(TicketAnalysisQueue).whenIdle();
    const readBack = (await (await request(`/tickets/${created.id}`, { headers: identity('helpdesk-1', 'helpdesk') })).json()) as {
      aiResult: { source: string; clarifiedDescription: string };
    };
    expect(readBack.aiResult).toMatchObject({ source: 'ai', clarifiedDescription: expect.stringContaining('office Wi-Fi') });
  });

  it('creates one ticket per submission, even when the same submission arrives more than once', async () => {
    const body = JSON.stringify({ title: 'Printer jam', description: 'Paper is stuck in tray 2.', teamId: 'it', issueType: 'hardware', project: 'Floor 2' });
    const send = (key: string) =>
      request('/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...identity('employee-1', 'employee') }, body });

    // Two copies at the same moment (a double click), then a retry after a dropped connection.
    const responses = [...(await Promise.all([send('submission-0001'), send('submission-0001')])), await send('submission-0001')];
    const ids = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(201);
        return ((await response.json()) as { id: string }).id;
      }),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await app.get(DataSource).getRepository(TicketEntity).countBy({ title: 'Printer jam' })).toBe(1);

    expect((await send('bad key!')).status).toBe(400);
    await app.get(TicketAnalysisQueue).whenIdle();
  });

  it('rejects requests without a valid token, including spoofed identity headers', async () => {
    const spoofed = await request('/tickets', { headers: { 'x-user-id': 'helpdesk-1', 'x-user-role': 'helpdesk' } });
    const forged = await request('/tickets', { headers: { Authorization: 'Bearer not-a-real-token' } });

    expect(spoofed.status).toBe(401);
    expect(forged.status).toBe(401);
  });

  it('audits refused requests and only lets Helpdesk read the audit log', async () => {
    const employeeRead = await request('/audit-log', { headers: identity('employee-1', 'employee') });
    expect(employeeRead.status).toBe(403);
    expect(employeeRead.headers.get('x-request-id')).toEqual(expect.any(String));
    await request('/tickets', { headers: { Authorization: 'Bearer forged' } });

    const helpdeskRead = await request('/audit-log?category=access', { headers: identity('helpdesk-1', 'helpdesk') });
    const log = (await helpdeskRead.json()) as { items: Array<{ action: string; actorId: string | null; outcome: string; summary: string }> };

    expect(helpdeskRead.status).toBe(200);
    expect(log.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'ACCESS_DENIED', actorId: 'employee-1', outcome: 'denied', summary: expect.stringContaining('GET /api/audit-log') }),
        expect.objectContaining({ action: 'SESSION_REJECTED', actorId: null, outcome: 'denied' }),
      ]),
    );
  });

  it('allows Helpdesk approval, denies employee approval, and rejects invalid input', async () => {
    const createResponse = await request('/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity('employee-1', 'employee') },
      body: JSON.stringify({
        title: 'Laptop cannot connect to Wi-Fi',
        description: 'The issue affects the office connection.',
        teamId: 'it',
        issueType: 'hardware',
        project: 'internal',
      }),
    });
    const created = (await createResponse.json()) as { id: string; status: TicketStatus };

    expect(createResponse.status).toBe(201);
    expect(created.status).toBe(TicketStatus.PENDING_HELPDESK_REVIEW);

    const deniedResponse = await request(`/tickets/${created.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity('employee-1', 'employee') },
      body: JSON.stringify({ priority: Priority.HIGH }),
    });

    expect(deniedResponse.status).toBe(403);

    const allowedResponse = await request(`/tickets/${created.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity('helpdesk-1', 'helpdesk') },
      body: JSON.stringify({ priority: Priority.HIGH }),
    });
    const approved = (await allowedResponse.json()) as { status: TicketStatus; priority: Priority };

    expect(allowedResponse.status).toBe(201);
    expect(approved).toMatchObject({ status: TicketStatus.APPROVED, priority: Priority.HIGH });

    const invalidResponse = await request('/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity('employee-1', 'employee') },
      body: JSON.stringify({ description: 'Missing title and required fields' }),
    });

    expect(invalidResponse.status).toBe(400);

    const unknownTeamResponse = await request('/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity('employee-1', 'employee') },
      body: JSON.stringify({ title: 'Chair', description: 'Broken chair', teamId: 'marketing', issueType: 'furniture', project: 'office' }),
    });

    expect(unknownTeamResponse.status).toBe(400);
  });

  describe('attachments', () => {
    const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

    function upload(ticketId: string, userId: string, files: Array<{ name: string; bytes: Buffer }>): Promise<Response> {
      const form = new FormData();
      for (const file of files) form.append('files', new Blob([new Uint8Array(file.bytes)]), file.name);
      return request(`/tickets/${ticketId}/attachments`, { method: 'POST', headers: identity(userId, 'employee'), body: form });
    }

    async function createTicket(): Promise<string> {
      const response = await request('/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...identity('employee-1', 'employee') },
        body: JSON.stringify({ title: 'Broken screen', description: 'Cracked after a fall.', teamId: 'it', issueType: 'hardware', project: 'Laptop' }),
      });
      return ((await response.json()) as { id: string }).id;
    }

    it('lets the requester attach files and anyone involved download them safely', async () => {
      const ticketId = await createTicket();

      const uploaded = await upload(ticketId, 'employee-1', [
        { name: 'screen.png', bytes: PNG_BYTES },
        { name: 'notes.txt', bytes: Buffer.from('It happened on Monday.') },
      ]);
      const attachments = (await uploaded.json()) as Array<{ id: string; fileName: string; stage: string; mimeType: string; storageKey?: string }>;
      expect(uploaded.status).toBe(201);
      expect(attachments.map((a) => [a.fileName, a.stage, a.mimeType])).toEqual([
        ['screen.png', 'submission', 'image/png'],
        ['notes.txt', 'submission', 'text/plain'],
      ]);
      expect(attachments[0].storageKey).toBeUndefined();

      const listed = (await (await request(`/tickets/${ticketId}/attachments`, { headers: identity('helpdesk-1', 'helpdesk') })).json()) as unknown[];
      expect(listed).toHaveLength(2);

      const download = await request(`/tickets/${ticketId}/attachments/${attachments[0].id}/download`, { headers: identity('helpdesk-1', 'helpdesk') });
      expect(download.status).toBe(200);
      expect(download.headers.get('content-disposition')).toContain('attachment; filename="screen.png"');
      expect(download.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await download.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

      expect((await request(`/tickets/${ticketId}/attachments/${attachments[0].id}/download`, { headers: identity('employee-9', 'employee') })).status).toBe(403);
      expect((await upload(ticketId, 'employee-9', [{ name: 'x.txt', bytes: Buffer.from('hi') }])).status).toBe(403);

      const history = (await (await request(`/tickets/${ticketId}/audit-events`, { headers: identity('employee-1', 'employee') })).json()) as Array<{ action: string; reason?: string }>;
      expect(history.at(-1)).toMatchObject({ action: 'ATTACHMENTS_ADDED', reason: 'screen.png, notes.txt' });
    });

    it('answers a missing or unreadable stored file with an error for that download only', async () => {
      const ticketId = await createTicket();
      const uploaded = (await (
        await upload(ticketId, 'employee-1', [
          { name: 'a.txt', bytes: Buffer.from('one') },
          { name: 'b.txt', bytes: Buffer.from('two') },
        ])
      ).json()) as Array<{ id: string }>;

      // A folder where the file should be: reading it used to raise an unhandled stream error that stopped the server.
      rmSync(join(attachmentsDir, uploaded[0].id));
      mkdirSync(join(attachmentsDir, uploaded[0].id));
      rmSync(join(attachmentsDir, uploaded[1].id));

      const unreadable = await request(`/tickets/${ticketId}/attachments/${uploaded[0].id}/download`, { headers: identity('employee-1', 'employee') });
      const missing = await request(`/tickets/${ticketId}/attachments/${uploaded[1].id}/download`, { headers: identity('employee-1', 'employee') });
      expect(unreadable.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { message: string }).message).toBe('The attachment file is missing from storage');

      // The server is still answering.
      expect((await request(`/tickets/${ticketId}`, { headers: identity('employee-1', 'employee') })).status).toBe(200);
    });

    it('refuses disallowed, disguised and oversized files without storing anything', async () => {
      const ticketId = await createTicket();

      const executable = await upload(ticketId, 'employee-1', [{ name: 'setup.exe', bytes: Buffer.from('MZ') }]);
      expect(executable.status).toBe(400);
      expect(((await executable.json()) as { message: string }).message).toContain('not an allowed file type');

      const disguised = await upload(ticketId, 'employee-1', [
        { name: 'fine.txt', bytes: Buffer.from('ok') },
        { name: 'photo.png', bytes: Buffer.from('<script>alert(1)</script>') },
      ]);
      expect(disguised.status).toBe(400);
      expect(((await disguised.json()) as { message: string }).message).toContain('does not look like a real .png file');

      const oversized = await upload(ticketId, 'employee-1', [{ name: 'big.txt', bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 0x61) }]);
      expect(oversized.status).toBe(413);

      const listed = (await (await request(`/tickets/${ticketId}/attachments`, { headers: identity('employee-1', 'employee') })).json()) as unknown[];
      expect(listed).toHaveLength(0);
    });

    it('lets the assignee attach resolution files only once they have claimed the ticket', async () => {
      await app.get(DataSource).getRepository(UserEntity).save({
        id: 'employee-2', email: 'sam@company.com', password: 'unused', role: 'employee', firstName: 'Sam', lastName: 'Reed', status: 'active', createdAt: new Date().toISOString(),
      });
      const ticketId = await createTicket();
      const helpdesk = { 'Content-Type': 'application/json', ...identity('helpdesk-1', 'helpdesk') };
      await request(`/tickets/${ticketId}/approve`, { method: 'POST', headers: helpdesk, body: JSON.stringify({ priority: Priority.LOW }) });
      await request(`/tickets/${ticketId}/assign`, { method: 'POST', headers: helpdesk, body: JSON.stringify({ assigneeId: 'employee-2', expectedDurationHours: 2 }) });

      expect((await upload(ticketId, 'employee-2', [{ name: 'fix.txt', bytes: Buffer.from('replaced') }])).status).toBe(409);

      await request(`/tickets/${ticketId}/claim`, { method: 'POST', headers: identity('employee-2', 'employee') });
      const uploaded = await upload(ticketId, 'employee-2', [{ name: 'fix.txt', bytes: Buffer.from('replaced the screen') }]);
      expect(uploaded.status).toBe(201);
      expect(((await uploaded.json()) as Array<{ stage: string }>)[0].stage).toBe('resolution');
    });
  });
});
