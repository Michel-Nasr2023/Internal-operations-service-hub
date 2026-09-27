import { DataSource } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketsService } from './tickets.service';
import { Priority, TicketStatus } from './ticket.types';
import { RqstyAiService } from '../ai/rqsty-ai.service';
import { UserEntity } from '../auth/user.entity';
import { NotificationEntity } from '../notifications/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TicketCommentEntity } from './ticket-comment.entity';
import { TicketViewEntity } from './ticket-view.entity';
import { TicketAttachmentEntity } from './ticket-attachment.entity';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { TicketAnalysisQueue } from './ticket-analysis.queue';

describe('TicketsService SQLite integration', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [TicketEntity, UserEntity, NotificationEntity, TicketCommentEntity, TicketViewEntity, AuditLogEntity, TicketAttachmentEntity],
      synchronize: true,
    }).initialize();
  });

  afterEach(async () => {
    // Let background AI analyses finish before the database closes.
    await Promise.all(queues.splice(0).map((queue) => queue.whenIdle()));
    await dataSource.destroy();
  });

  function users() {
    const now = new Date().toISOString();
    const base = { password: 'unused', status: 'active' as const, createdAt: now };
    return [
      { ...base, id: 'employee-1', email: 'employee@company.com', role: 'employee' as const, firstName: 'Maya', lastName: 'Stone' },
      { ...base, id: 'helpdesk-1', email: 'helpdesk@company.com', role: 'helpdesk' as const, firstName: 'Leo', lastName: 'Warren' },
      { ...base, id: 'employee-2', email: 'sam@company.com', role: 'employee' as const, firstName: 'Sam', lastName: 'Reed' },
      { ...base, id: 'employee-3', email: 'outsider@company.com', role: 'employee' as const, firstName: 'Out', lastName: 'Sider' },
    ];
  }

  const AI_RESULT = {
    source: 'ai' as const,
    summary: 'VPN rejects credentials',
    clarifiedDescription: 'The employee reports that the internal VPN rejects their credentials.',
    issueType: 'access' as const,
    severity: 'high' as const,
    recommendedAction: 'Verify account permissions and re-test access.',
    missingInformation: ['When did this start?'],
    generatedAt: new Date().toISOString(),
  };
  const queues: TicketAnalysisQueue[] = [];

  function createServices(analyzeTicket: () => Promise<unknown> = async () => AI_RESULT) {
    const auditService = new AuditService(dataSource.getRepository(AuditLogEntity), dataSource.getRepository(TicketEntity), dataSource.getRepository(UserEntity));
    const queue = new TicketAnalysisQueue(
      dataSource.getRepository(TicketEntity),
      dataSource.getRepository(UserEntity),
      { analyzeTicket } as unknown as RqstyAiService,
      auditService,
    );
    queues.push(queue);
    const notificationsService = new NotificationsService(
      dataSource.getRepository(NotificationEntity),
      dataSource.getRepository(TicketEntity),
      dataSource.getRepository(UserEntity),
    );
    const service = new TicketsService(
      dataSource.getRepository(TicketEntity),
      dataSource.getRepository(UserEntity),
      dataSource.getRepository(TicketCommentEntity),
      dataSource.getRepository(TicketViewEntity),
      dataSource.getRepository(TicketAttachmentEntity),
      queue,
      notificationsService,
      auditService,
    );
    return { service, notificationsService, queue };
  }

  it('stores comments from ticket participants, notifies the others, and closes comments on resolution', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service, notificationsService } = createServices();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const assignee = { id: 'employee-2', role: 'employee' as const };
    const outsider = { id: 'employee-3', role: 'employee' as const };

    const ticket = await service.create({ title: 'Printer jam', description: 'Jams.', teamId: 'it', issueType: 'hardware', project: 'office' }, employee);
    await service.approve(ticket.id, { priority: Priority.LOW }, helpdesk);
    await service.assign(ticket.id, { assigneeId: assignee.id, expectedDurationHours: 2 }, helpdesk);
    await service.claim(ticket.id, assignee);

    await service.addComment(ticket.id, { body: '  Ordered a new roller.  ' }, assignee);
    await service.addComment(ticket.id, { body: 'Thanks!' }, employee);
    await expect(service.addComment(ticket.id, { body: 'Hi' }, outsider)).rejects.toThrow('not authorized');

    const comments = await service.listComments(ticket.id, helpdesk);
    expect(comments.map((comment) => [comment.authorName, comment.body])).toEqual([
      ['Sam Reed', 'Ordered a new roller.'],
      ['Maya Stone', 'Thanks!'],
    ]);

    const requesterInbox = await notificationsService.listForUser('employee-1');
    expect(requesterInbox.filter((n) => n.kind === 'ticket-comment').map((n) => n.message)).toEqual(['Sam Reed: Ordered a new roller.']);
    const assigneeInbox = await notificationsService.listForUser('employee-2');
    expect(assigneeInbox.filter((n) => n.kind === 'ticket-comment').map((n) => n.message)).toEqual(['Maya Stone: Thanks!']);

    await service.resolve(ticket.id, { feedback: 'Replaced the roller.' }, assignee);
    await expect(service.addComment(ticket.id, { body: 'One more thing' }, employee)).rejects.toThrow('Comments are closed');
  });

  it('writes every ticket action to the audit log with a readable summary', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service } = createServices();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };

    const ticket = await service.create({ title: 'Badge reader', description: 'Door will not open.', teamId: 'facilities', issueType: 'access', project: 'Office' }, employee);
    await service.approve(ticket.id, { priority: Priority.HIGH }, helpdesk);
    await service.assign(ticket.id, { assigneeId: 'employee-2', expectedDurationHours: 3 }, helpdesk);

    const rows = (await dataSource.getRepository(AuditLogEntity).find({ where: { targetId: ticket.id }, order: { timestamp: 'ASC' } })).filter(
      (row) => !row.action.startsWith('AI_'),
    );
    expect(rows.map((row) => [row.action, row.actorId, row.actorRole, row.summary])).toEqual([
      ['TICKET_SUBMITTED', 'employee-1', 'employee', 'Submitted "Badge reader"'],
      ['TICKET_APPROVED', 'helpdesk-1', 'helpdesk', 'Approved "Badge reader" with high priority'],
      ['TICKET_ASSIGNED', 'helpdesk-1', 'helpdesk', 'Assigned "Badge reader" to Sam Reed (3h)'],
    ]);

    const history = await service.auditEvents(ticket.id, employee);
    expect(history.map((event) => event.actorName)).toEqual(['Maya Stone', 'Leo Warren', 'Leo Warren']);
  });

  it('tracks which tickets each user has opened, per user', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service } = createServices();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const assignee = { id: 'employee-2', role: 'employee' as const };

    const ticket = await service.create({ title: 'Monitor', description: 'Flickers.', teamId: 'it', issueType: 'hardware', project: 'office' }, employee);
    expect((await service.list(helpdesk))[0].viewedAt).toBeUndefined();

    await service.markViewed(ticket.id, helpdesk);
    expect((await service.list(helpdesk))[0].viewedAt).toEqual(expect.any(String));
    expect((await service.list(employee))[0].viewedAt).toBeUndefined();

    await service.approve(ticket.id, { priority: Priority.LOW }, helpdesk);
    await service.assign(ticket.id, { assigneeId: assignee.id, expectedDurationHours: 1 }, helpdesk);
    expect((await service.list(assignee))[0].viewedAt).toBeUndefined();
    await service.claim(ticket.id, assignee);
    expect((await service.list(assignee))[0].viewedAt).toEqual(expect.any(String));
  });

  it('saves the ticket immediately and fills in the AI analysis in the background', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service, notificationsService, queue } = createServices();
    const employee = { id: 'employee-1', role: 'employee' as const };

    const created = await service.create({ title: 'VPN access issue', description: 'The internal VPN rejects my credentials.', teamId: 'it', issueType: 'access', project: 'Remote access' }, employee);

    expect(created.aiResult).toMatchObject({ source: 'pending' });
    expect(created.requesterName).toBe('Maya Stone');
    expect((await notificationsService.listForUser('helpdesk-1'))[0]).toMatchObject({ kind: 'ticket-submitted', ticketId: created.id });

    await queue.whenIdle();
    const persisted = await dataSource.getRepository(TicketEntity).findOneBy({ id: created.id });
    expect(persisted).toMatchObject({ status: TicketStatus.PENDING_HELPDESK_REVIEW, aiResult: { source: 'ai', missingInformation: ['When did this start?'] } });
    expect(persisted?.auditEvents.map((event) => event.action)).toEqual(['TICKET_SUBMITTED']);
    expect(await dataSource.getRepository(AuditLogEntity).findOneBy({ action: 'AI_ANALYSIS_COMPLETED', targetId: created.id })).not.toBeNull();
  });

  it('does not lose the AI analysis when Helpdesk acts on the ticket while the AI is still working', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    let finishAnalysis: () => void = () => undefined;
    const aiDone = new Promise<void>((resolve) => (finishAnalysis = resolve));
    const { service, queue } = createServices(async () => {
      await aiDone;
      return AI_RESULT;
    });

    const created = await service.create({ title: 'VPN', description: 'Rejects me.', teamId: 'it', issueType: 'access', project: 'VPN' }, { id: 'employee-1', role: 'employee' });
    // TypeORM mutates the object passed to save(), so record a copy of what each save was asked to write.
    const repository = dataSource.getRepository(TicketEntity);
    const originalSave = repository.save.bind(repository);
    const written: Array<{ aiResult?: unknown }> = [];
    jest.spyOn(repository, 'save').mockImplementation(((entity: { aiResult?: unknown }) => {
      written.push({ ...entity });
      return originalSave(entity as TicketEntity);
    }) as typeof repository.save);

    try {
      await service.approve(created.id, { priority: Priority.HIGH }, { id: 'helpdesk-1', role: 'helpdesk' });
      // A workflow save never writes the analysis column, so a stale "pending" can't overwrite a finished result.
      expect(written).toHaveLength(1);
      expect('aiResult' in written[0] ? written[0].aiResult : undefined).toBeUndefined();
    } finally {
      finishAnalysis();
    }
    await queue.whenIdle();
    await service.setPriority(created.id, { priority: Priority.URGENT }, { id: 'helpdesk-1', role: 'helpdesk' });

    const persisted = await dataSource.getRepository(TicketEntity).findOneBy({ id: created.id });
    expect(persisted).toMatchObject({ status: TicketStatus.APPROVED, priority: Priority.URGENT, aiResult: { source: 'ai' } });
  });

  it('records an AI failure instead of a made-up analysis, and lets Helpdesk retry it', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const failure = { source: 'failed' as const, failureCode: 'provider-error', failureReason: 'The AI service reported an error (503) after 3 attempts.', attempts: 3, generatedAt: new Date().toISOString() };
    const replies: unknown[] = [failure, AI_RESULT];
    const { service, queue } = createServices(async () => replies.shift());
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };

    const created = await service.create({ title: 'Laptop', description: 'Slow.', teamId: 'it', issueType: 'hardware', project: 'Laptop' }, { id: 'employee-1', role: 'employee' });
    await queue.whenIdle();
    expect((await service.findOne(created.id, helpdesk)).aiResult).toEqual(failure);
    expect(await dataSource.getRepository(AuditLogEntity).findOneBy({ action: 'AI_ANALYSIS_FAILED', targetId: created.id })).toMatchObject({ outcome: 'failure' });

    await expect(service.retryAnalysis(created.id, { id: 'employee-1', role: 'employee' })).rejects.toThrow('Only Helpdesk');
    expect((await service.retryAnalysis(created.id, helpdesk)).aiResult).toMatchObject({ source: 'pending' });
    await queue.whenIdle();
    expect((await service.findOne(created.id, helpdesk)).aiResult).toMatchObject({ source: 'ai' });
  });
});
