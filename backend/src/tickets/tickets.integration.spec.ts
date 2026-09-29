import { DataSource } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketsService } from './tickets.service';
import { Priority, TicketAiFailure, TicketStatus } from './ticket.types';
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

  it('writes every ticket action to the audit log by ticket ID, never with the ticket text', async () => {
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
    const ref = `ticket ${ticket.id.slice(0, 8)}`;
    expect(rows.map((row) => [row.action, row.actorId, row.actorRole, row.summary])).toEqual([
      ['TICKET_SUBMITTED', 'employee-1', 'employee', `Submitted ${ref}`],
      ['TICKET_APPROVED', 'helpdesk-1', 'helpdesk', `Approved ${ref} with high priority`],
      ['TICKET_ASSIGNED', 'helpdesk-1', 'helpdesk', `Assigned ${ref} to user employee-2 (3h)`],
    ]);

    // A rejection reason is free text too: it stays on the ticket, not in the log.
    const other = await service.create({ title: 'Parking badge', description: 'Lost it.', teamId: 'facilities', issueType: 'access', project: 'Garage' }, employee);
    await service.reject(other.id, { reason: 'Please ask reception for a temporary badge.' }, helpdesk);
    const everything = JSON.stringify(await dataSource.getRepository(AuditLogEntity).find());
    for (const text of ['Badge reader', 'Door will not open', 'Parking badge', 'Lost it', 'temporary badge']) expect(everything).not.toContain(text);

    const history = await service.auditEvents(ticket.id, employee);
    expect(history.map((event) => event.actorName)).toEqual(['Maya Stone', 'Leo Warren', 'Leo Warren']);
  });

  it('records which Helpdesk member reviewed and assigned a ticket, and names them in notifications', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service, notificationsService } = createServices();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };

    const ticket = await service.create({ title: 'Headset', description: 'No sound.', teamId: 'it', issueType: 'hardware', project: 'Desk 4' }, employee);
    await service.approve(ticket.id, { priority: Priority.MEDIUM, assigneeId: 'employee-2', expectedDurationHours: 2 }, helpdesk);

    const seenByRequester = await service.findOne(ticket.id, employee);
    expect(seenByRequester).toMatchObject({ reviewedBy: 'helpdesk-1', reviewedByName: 'Leo Warren', assignedBy: 'helpdesk-1', assignedByName: 'Leo Warren' });
    expect(seenByRequester.reviewedAt).toEqual(expect.any(String));

    const requesterInbox = await notificationsService.listForUser('employee-1');
    expect(requesterInbox.find((n) => n.kind === 'ticket-approved')?.message).toBe('Approved by Leo Warren with medium priority.');
    const assigneeInbox = await notificationsService.listForUser('employee-2');
    expect(assigneeInbox.find((n) => n.kind === 'ticket-assigned')?.message).toBe('Leo Warren assigned this ticket to you. Expected duration: 2h.');

    // Returning the ticket to the queue clears who assigned it.
    await service.handOverAssignments('employee-2', { mode: 'queue' }, helpdesk, 'test');
    expect((await dataSource.getRepository(TicketEntity).findOneBy({ id: ticket.id }))?.assignedBy).toBeNull();
  });

  it('fills in reviewer and assigner for older tickets from their history', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service } = createServices();
    const at = new Date().toISOString();
    await dataSource.getRepository(TicketEntity).save({
      id: 'old-1',
      requesterId: 'employee-1',
      teamId: 'it',
      issueType: 'hardware',
      project: 'Office',
      title: 'Old ticket',
      description: 'From before the change',
      status: TicketStatus.ASSIGNED,
      assigneeId: 'employee-2',
      assignedAt: at,
      createdAt: at,
      updatedAt: at,
      version: 3,
      auditEvents: [
        { id: 'a1', ticketId: 'old-1', action: 'TICKET_SUBMITTED', actorId: 'employee-1', timestamp: at },
        { id: 'a2', ticketId: 'old-1', action: 'TICKET_APPROVED', actorId: 'helpdesk-1', timestamp: at },
        { id: 'a3', ticketId: 'old-1', action: 'TICKET_ASSIGNED', actorId: 'helpdesk-1', timestamp: at },
      ],
    } as TicketEntity);

    await service.onModuleInit();

    expect(await dataSource.getRepository(TicketEntity).findOneBy({ id: 'old-1' })).toMatchObject({ reviewedBy: 'helpdesk-1', reviewedAt: at, assignedBy: 'helpdesk-1' });
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
    // Record a copy of the columns each workflow save was asked to write.
    const repository = dataSource.getRepository(TicketEntity);
    const originalUpdate = repository.update.bind(repository);
    const written: Array<Record<string, unknown>> = [];
    jest.spyOn(repository, 'update').mockImplementation(((criteria: Parameters<typeof repository.update>[0], changes: Parameters<typeof repository.update>[1]) => {
      written.push({ ...(changes as Record<string, unknown>) });
      return originalUpdate(criteria, changes);
    }) as typeof repository.update);

    try {
      await service.approve(created.id, { priority: Priority.HIGH }, { id: 'helpdesk-1', role: 'helpdesk' });
      // A workflow save never writes the analysis column, so a stale "pending" can't overwrite a finished result.
      expect(written).toHaveLength(1);
      expect(written[0].aiResult).toBeUndefined();
    } finally {
      finishAnalysis();
    }
    await queue.whenIdle();
    await service.setPriority(created.id, { priority: Priority.URGENT }, { id: 'helpdesk-1', role: 'helpdesk' });

    const persisted = await dataSource.getRepository(TicketEntity).findOneBy({ id: created.id });
    expect(persisted).toMatchObject({ status: TicketStatus.APPROVED, priority: Priority.URGENT, aiResult: { source: 'ai' } });
  });

  it('lists only the tickets each person may see, without their history', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service, queue } = createServices();
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const submit = (id: string, title: string) =>
      service.create({ title, description: 'Details.', teamId: 'it', issueType: 'hardware', project: 'Office' }, { id, role: 'employee' });

    const own = await submit('employee-1', 'Own request');
    const assigned = await submit('employee-2', 'Assigned to Maya');
    const other = await submit('employee-3', 'Someone else');
    await service.approve(assigned.id, { priority: Priority.HIGH, assigneeId: 'employee-1', expectedDurationHours: 2 }, helpdesk);
    await queue.whenIdle();

    expect((await service.list({ id: 'employee-1', role: 'employee' })).map((ticket) => ticket.id).sort()).toEqual([own.id, assigned.id].sort());
    expect((await service.list({ id: 'employee-3', role: 'employee' })).map((ticket) => ticket.id)).toEqual([other.id]);
    expect((await service.list({ id: 'employee-1', role: 'employee' }, Priority.HIGH)).map((ticket) => ticket.id)).toEqual([assigned.id]);

    const everything = await service.list(helpdesk);
    expect(everything).toHaveLength(3);
    for (const ticket of everything) expect(ticket).not.toHaveProperty('auditEvents');
  });

  it('never lets two changes made at the same moment overwrite each other', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const { service, queue } = createServices();
    const employee = { id: 'employee-1', role: 'employee' as const };
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };
    const repository = dataSource.getRepository(TicketEntity);
    const newTicket = () => service.create({ title: 'VPN', description: 'Rejects me.', teamId: 'it', issueType: 'access', project: 'VPN' }, employee);

    // A comment whose save starts from a copy read just before Helpdesk approved the ticket.
    const commented = await newTicket();
    await queue.whenIdle();
    const beforeApproval = await repository.findOneBy({ id: commented.id });
    await service.approve(commented.id, { priority: Priority.HIGH }, helpdesk);
    const reads = jest.spyOn(repository, 'findOneBy');
    reads.mockResolvedValueOnce(structuredClone(beforeApproval)).mockResolvedValueOnce(structuredClone(beforeApproval));
    await service.addComment(commented.id, { body: 'Any update?' }, employee);
    reads.mockRestore();

    const afterComment = await repository.findOneBy({ id: commented.id });
    expect(afterComment?.status).toBe(TicketStatus.APPROVED);
    expect(afterComment?.auditEvents.map((event) => event.action)).toEqual(['TICKET_SUBMITTED', 'TICKET_APPROVED', 'COMMENT_ADDED']);

    // Two Helpdesk members handling the same Pending ticket: the later one is refused, not silently applied.
    const contested = await newTicket();
    await queue.whenIdle();
    const beforeFirstDecision = await repository.findOneBy({ id: contested.id });
    await service.approve(contested.id, { priority: Priority.LOW }, helpdesk);
    jest.spyOn(repository, 'findOneBy').mockResolvedValueOnce(structuredClone(beforeFirstDecision));
    await expect(service.reject(contested.id, { reason: 'Duplicate request' }, { id: 'helpdesk-2', role: 'helpdesk' })).rejects.toThrow(
      /needs the ticket to be Pending, but it is Approved/,
    );
    jest.restoreAllMocks();

    expect(await repository.findOneBy({ id: contested.id })).toMatchObject({ status: TicketStatus.APPROVED, priority: Priority.LOW, reviewedBy: 'helpdesk-1' });
  });

  it('records an AI failure instead of a made-up analysis, and lets Helpdesk retry it', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const failure = { source: 'failed' as const, failureCode: 'provider-error', failureReason: 'The AI service reported an error (503) after 3 attempts.', attempts: 3, generatedAt: new Date().toISOString() };
    const replies: unknown[] = [failure, AI_RESULT];
    const { service, queue } = createServices(async () => replies.shift());
    const helpdesk = { id: 'helpdesk-1', role: 'helpdesk' as const };

    const created = await service.create({ title: 'Laptop', description: 'Slow.', teamId: 'it', issueType: 'hardware', project: 'Laptop' }, { id: 'employee-1', role: 'employee' });
    await queue.whenIdle();
    // Not marked temporary, so no automatic retry is planned: only Helpdesk's button.
    expect((await service.findOne(created.id, helpdesk)).aiResult).toEqual({ ...failure, autoRetries: 0 });
    expect(await dataSource.getRepository(AuditLogEntity).findOneBy({ action: 'AI_ANALYSIS_FAILED', targetId: created.id })).toMatchObject({ outcome: 'failure' });

    await expect(service.retryAnalysis(created.id, { id: 'employee-1', role: 'employee' })).rejects.toThrow('Only Helpdesk');
    expect((await service.retryAnalysis(created.id, helpdesk)).aiResult).toMatchObject({ source: 'pending' });
    await queue.whenIdle();
    expect((await service.findOne(created.id, helpdesk)).aiResult).toMatchObject({ source: 'ai' });
  });

  it('retries an analysis on its own after a temporary AI outage, up to 3 times', async () => {
    await dataSource.getRepository(UserEntity).save(users());
    const outage = () => ({
      source: 'failed' as const,
      failureCode: 'network',
      failureReason: 'The server could not reach the AI service after 3 attempts.',
      attempts: 3,
      temporary: true,
      generatedAt: new Date().toISOString(),
    });
    let aiIsDown = true;
    const { service, queue } = createServices(async () => (aiIsDown ? outage() : AI_RESULT));
    const repository = dataSource.getRepository(TicketEntity);
    const analysisOf = async (id: string) => (await repository.findOneBy({ id }))?.aiResult as TicketAiFailure;
    const submit = () => service.create({ title: 'VPN', description: 'Rejects me.', teamId: 'it', issueType: 'access', project: 'VPN' }, { id: 'employee-1', role: 'employee' });

    // Recovers on the first automatic retry once the AI is back.
    const recovering = await submit();
    await queue.whenIdle();
    const first = await analysisOf(recovering.id);
    expect(first).toMatchObject({ source: 'failed', autoRetries: 0, retryAt: expect.any(String) });
    await queue.retryDueFailures(new Date(Date.parse(first.retryAt!) - 1000));
    expect((await analysisOf(recovering.id)).source).toBe('failed');

    aiIsDown = false;
    await queue.retryDueFailures(new Date(Date.parse(first.retryAt!) + 1000));
    await queue.whenIdle();
    expect(await analysisOf(recovering.id)).toMatchObject({ source: 'ai' });

    // A long outage: three automatic retries, then only the manual "Retry" button is left.
    aiIsDown = true;
    const stuck = await submit();
    await queue.whenIdle();
    for (let retry = 1; retry <= 3; retry += 1) {
      await queue.retryDueFailures(new Date(Date.parse((await analysisOf(stuck.id)).retryAt!) + 1000));
      await queue.whenIdle();
      expect(await analysisOf(stuck.id)).toMatchObject({ source: 'failed', autoRetries: retry });
    }
    expect(await analysisOf(stuck.id)).not.toHaveProperty('retryAt');
  });
});
