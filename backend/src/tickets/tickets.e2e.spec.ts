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

// The AI provider is replaced with a stub here: the real provider is slow and rate-limited, and its
// parsing, retries and failure handling are covered in rqsty-ai.service.spec.ts.
jest.setTimeout(20000);

describe('Tickets API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [TicketEntity, UserEntity, NotificationEntity, TicketCommentEntity, TicketViewEntity, AuditLogEntity],
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
});
