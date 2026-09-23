import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { TypeOrmModule } from '@nestjs/typeorm';
import { INestApplication } from '@nestjs/common';
import { TicketsModule } from './tickets.module';
import { TicketEntity } from './ticket.entity';
import { Priority, TicketStatus } from './ticket.types';

// These tests call the real AI provider during ticket creation; allow extra time for network latency.
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
          entities: [TicketEntity],
          synchronize: true,
        }),
        TicketsModule,
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

  async function request(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, options);
  }

  function identity(id: string, role: string): HeadersInit {
    return { 'x-user-id': id, 'x-user-role': role };
  }

  it('creates a ticket and returns the structured AI result below the original request', async () => {
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
    const created = (await createResponse.json()) as {
      id: string;
      status: TicketStatus;
      aiResult: { employeeId: string; productName: string; issueType: string; severity: string; recommendedAction: string };
    };

    expect(createResponse.status).toBe(201);
    expect(created.status).toBe(TicketStatus.PENDING_HELPDESK_REVIEW);
    expect(created.aiResult).toMatchObject({ employeeId: 'employee-1', productName: 'Laptop cannot connect to Wi-Fi' });
    expect(['hardware', 'software', 'network', 'access']).toContain(created.aiResult.issueType);
    expect(['low', 'medium', 'high', 'urgent']).toContain(created.aiResult.severity);
    expect(created.aiResult.recommendedAction).toEqual(expect.any(String));
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
  });
});
