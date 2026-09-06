import { ForbiddenException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { Priority, TicketStatus } from './ticket.types';

describe('TicketsService', () => {
  it('moves a ticket through the documented workflow', () => {
    const service = new TicketsService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const assignee = { id: 'assignee-1', role: 'assignee' as const };

    const ticket = service.create({ title: 'Laptop issue', description: 'Cannot connect', teamId: 'it', issueType: 'hardware', project: 'internal' }, employee);
    expect(ticket.status).toBe(TicketStatus.PENDING_HELPDESK_REVIEW);

    service.approve(ticket.id, { priority: Priority.HIGH }, helpdesk);
    service.assign(ticket.id, { assigneeId: assignee.id, expectedDurationHours: 8 }, helpdesk);
    service.claim(ticket.id, assignee);
    const resolved = service.resolve(ticket.id, assignee);

    expect(resolved.status).toBe(TicketStatus.RESOLVED);
    expect(resolved.auditEvents).toHaveLength(5);
  });

  it('rejects invalid state transitions', () => {
    const service = new TicketsService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const ticket = service.create({ title: 'Laptop issue', description: 'Cannot connect', teamId: 'it', issueType: 'hardware', project: 'internal' }, employee);

    expect(() => service.resolve(ticket.id, employee)).toThrow(ForbiddenException);
  });
});
