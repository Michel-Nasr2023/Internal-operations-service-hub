import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketsService } from './tickets.service';
import { Priority, TicketStatus } from './ticket.types';
import { TicketAnalysisQueue } from './ticket-analysis.queue';
import { UserEntity } from '../auth/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TicketCommentEntity } from './ticket-comment.entity';
import { TicketViewEntity } from './ticket-view.entity';
import { TicketAttachmentEntity } from './ticket-attachment.entity';
import { AuditService } from '../audit/audit.service';

const USERS = [
  { id: 'employee-1', firstName: 'Maya', lastName: 'Stone', jobTitle: 'Operations Analyst', status: 'active' },
  { id: 'assignee-1', firstName: 'Sam', lastName: 'Reed', jobTitle: 'Technician', status: 'active' },
];

describe('TicketsService', () => {
  let sent: Array<{ to: string; kind: string }>;

  function createService(): TicketsService {
    sent = [];
    const notificationsService = {
      notifyHelpdesk: async (draft: { kind: string }) => void sent.push({ to: 'helpdesk', kind: draft.kind }),
      notifyUser: async (userId: string | undefined, draft: { kind: string }, exceptUserId?: string) => {
        if (userId && userId !== exceptUserId) sent.push({ to: userId, kind: draft.kind });
      },
    } as unknown as NotificationsService;

    const records = new Map<string, TicketEntity>();
    const repository = {
      save: async (ticket: TicketEntity) => {
        records.set(ticket.id, ticket);
        return ticket;
      },
      find: async () => [...records.values()],
      findOneBy: async ({ id }: { id: string }) => records.get(id),
    } as unknown as Repository<TicketEntity>;

    const userRepository = {
      findOneBy: async ({ id }: { id: string }) => USERS.find((user) => user.id === id) ?? null,
      findBy: async () => USERS,
    } as unknown as Repository<UserEntity>;

    const analysisQueue = { enqueue: async () => undefined } as unknown as TicketAnalysisQueue;

    const commentRepository = {} as Repository<TicketCommentEntity>;
    const viewRepository = { upsert: async () => undefined, findBy: async () => [] } as unknown as Repository<TicketViewEntity>;

    const auditService = { record: async () => undefined, withActorNames: async <T>(rows: T[]) => rows } as unknown as AuditService;

    const attachmentRepository = { find: async () => [] } as unknown as Repository<TicketAttachmentEntity>;

    return new TicketsService(repository, userRepository, commentRepository, viewRepository, attachmentRepository, analysisQueue, notificationsService, auditService);
  }

  it('moves a ticket through the documented workflow', async () => {
    const service = createService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const assignee = { id: 'assignee-1', role: 'assignee' as const };

    const ticket = await service.create({ title: 'Laptop issue', description: 'Cannot connect', teamId: 'it', issueType: 'hardware', project: 'internal' }, employee);
    expect(ticket.status).toBe(TicketStatus.PENDING_HELPDESK_REVIEW);
    expect(ticket.requesterName).toBe('Maya Stone');
    expect(ticket.description).toBe('Cannot connect');
    expect(ticket.aiResult).toMatchObject({ source: 'pending' });

    await service.approve(ticket.id, { priority: Priority.HIGH }, helpdesk);
    await service.assign(ticket.id, { assigneeId: assignee.id, expectedDurationHours: 8 }, helpdesk);
    await service.claim(ticket.id, assignee);
    const resolved = await service.resolve(ticket.id, { feedback: 'Reinstalled the driver and confirmed connectivity.' }, assignee);

    expect(resolved.status).toBe(TicketStatus.RESOLVED);
    expect(resolved.assigneeName).toBe('Sam Reed');
    expect(sent).toEqual([
      { to: 'helpdesk', kind: 'ticket-submitted' },
      { to: 'employee-1', kind: 'ticket-approved' },
      { to: 'assignee-1', kind: 'ticket-assigned' },
      { to: 'helpdesk', kind: 'ticket-resolved' },
      { to: 'employee-1', kind: 'ticket-resolved' },
    ]);
    expect(resolved.auditEvents).toHaveLength(5);
  });

  it('rejects invalid state transitions', async () => {
    const service = createService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const ticket = await service.create({ title: 'Laptop issue', description: 'Cannot connect', teamId: 'it', issueType: 'hardware', project: 'internal' }, employee);

    await expect(service.resolve(ticket.id, { feedback: 'Not applicable.' }, employee)).rejects.toThrow(ForbiddenException);
  });

  it('refuses to assign a ticket to a user who does not exist', async () => {
    const service = createService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const ticket = await service.create({ title: 'Laptop issue', description: 'Cannot connect', teamId: 'it', issueType: 'hardware', project: 'internal' }, employee);
    await service.approve(ticket.id, { priority: Priority.LOW }, helpdesk);

    await expect(service.assign(ticket.id, { assigneeId: 'ghost-99', expectedDurationHours: 4 }, helpdesk)).rejects.toThrow(BadRequestException);
  });

  it('does not notify an employee about resolving their own ticket', async () => {
    const service = createService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const ticket = await service.create({ title: 'Desk lamp', description: 'Broken', teamId: 'facilities', issueType: 'hardware', project: 'office' }, employee);
    await service.approve(ticket.id, { priority: Priority.LOW }, helpdesk);
    await service.assign(ticket.id, { assigneeId: employee.id, expectedDurationHours: 1 }, helpdesk);
    await service.claim(ticket.id, employee);
    sent = [];

    await service.resolve(ticket.id, { feedback: 'Replaced the bulb.' }, employee);

    expect(sent).toEqual([{ to: 'helpdesk', kind: 'ticket-resolved' }]);
  });

  it('approves and assigns in one step, and changes nothing when the assignee is invalid', async () => {
    const service = createService();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const ticket = await service.create({ title: 'Mouse', description: 'Broken', teamId: 'it', issueType: 'hardware', project: 'Desk' }, employee);

    await expect(service.approve(ticket.id, { priority: Priority.HIGH, assigneeId: 'ghost-99', expectedDurationHours: 2 }, helpdesk)).rejects.toThrow(BadRequestException);
    expect((await service.findOne(ticket.id, helpdesk)).status).toBe(TicketStatus.PENDING_HELPDESK_REVIEW);

    const approved = await service.approve(ticket.id, { priority: Priority.HIGH, assigneeId: 'assignee-1', expectedDurationHours: 2 }, helpdesk);
    expect(approved).toMatchObject({ status: TicketStatus.ASSIGNED, priority: Priority.HIGH, assigneeId: 'assignee-1', expectedDurationHours: 2 });
    expect(approved.auditEvents.map((event) => event.action)).toEqual(['TICKET_SUBMITTED', 'TICKET_APPROVED', 'TICKET_ASSIGNED']);

    await expect(service.approve(ticket.id, { priority: Priority.LOW }, helpdesk)).rejects.toThrow(
      'This action needs the ticket to be Pending, but it is Assigned. Refresh to see its latest state.',
    );
  });
});
