import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketsService } from './tickets.service';
import { Priority, TicketStatus } from './ticket.types';
import { RqstyAiService } from '../ai/rqsty-ai.service';

describe('TicketsService', () => {
  function createService(): TicketsService {
    const records = new Map<string, TicketEntity>();
    const repository = {
      save: async (ticket: TicketEntity) => {
        records.set(ticket.id, ticket);
        return ticket;
      },
      find: async () => [...records.values()],
      findOneBy: async ({ id }: { id: string }) => records.get(id),
    } as unknown as Repository<TicketEntity>;

    const rqstyAiService = {
      generateStructuredResult: async (input: { employeeId: string; jobTitle: string; productName: string; freeText: string }) => ({
        employeeId: input.employeeId,
        jobTitle: input.jobTitle,
        freeText: input.freeText,
        productName: input.productName,
        issueType: 'hardware' as const,
        severity: 'low' as const,
        recommendedAction: 'Run a hardware health check.',
      }),
    } as unknown as RqstyAiService;

    return new TicketsService(repository, rqstyAiService);
  }

  it('moves a ticket through the documented workflow', async () => {
    const service = createService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const assignee = { id: 'assignee-1', role: 'assignee' as const };

    const ticket = await service.create({ title: 'Laptop issue', description: 'Cannot connect', teamId: 'it', issueType: 'hardware', project: 'internal' }, employee);
    expect(ticket.status).toBe(TicketStatus.PENDING_HELPDESK_REVIEW);

    await service.approve(ticket.id, { priority: Priority.HIGH }, helpdesk);
    await service.assign(ticket.id, { assigneeId: assignee.id, expectedDurationHours: 8 }, helpdesk);
    await service.claim(ticket.id, assignee);
    const resolved = await service.resolve(ticket.id, { feedback: 'Reinstalled the driver and confirmed connectivity.' }, assignee);

    expect(resolved.status).toBe(TicketStatus.RESOLVED);
    expect(resolved.auditEvents).toHaveLength(5);
  });

  it('rejects invalid state transitions', async () => {
    const service = createService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const ticket = await service.create({ title: 'Laptop issue', description: 'Cannot connect', teamId: 'it', issueType: 'hardware', project: 'internal' }, employee);

    await expect(service.resolve(ticket.id, { feedback: 'Not applicable.' }, employee)).rejects.toThrow(ForbiddenException);
  });
});
