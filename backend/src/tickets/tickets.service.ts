import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { AddCommentDto, AssignTicketDto, CreateTicketDto, RejectTicketDto, ResolveTicketDto, SetPriorityDto } from './ticket.dto';
import { TicketEntity } from './ticket.entity';
import { AuthenticatedUser, AuditEvent, Priority, Ticket, TicketComment, TicketStatus, TicketView } from './ticket.types';
import { TicketCommentEntity } from './ticket-comment.entity';
import { TicketViewEntity } from './ticket-view.entity';
import { TicketAnalysisQueue } from './ticket-analysis.queue';
import { UserEntity } from '../auth/user.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(TicketCommentEntity) private readonly commentRepository: Repository<TicketCommentEntity>,
    @InjectRepository(TicketViewEntity) private readonly viewRepository: Repository<TicketViewEntity>,
    private readonly analysisQueue: TicketAnalysisQueue,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  // Audit events added since the ticket was loaded; written to the system audit log after the ticket saves.
  private readonly pendingAudit = new WeakMap<Ticket, Array<{ event: AuditEvent; actor: AuthenticatedUser }>>();

  // Saves immediately; the AI analysis runs afterwards in the background (see TicketAnalysisQueue).
  async create(dto: CreateTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const now = new Date().toISOString();
    const ticket: Ticket = {
      id: randomUUID(),
      requesterId: user.id,
      teamId: dto.teamId,
      issueType: dto.issueType,
      project: dto.project,
      title: dto.title,
      description: dto.description,
      aiResult: { source: 'pending', requestedAt: now },
      status: TicketStatus.PENDING_HELPDESK_REVIEW,
      createdAt: now,
      updatedAt: now,
      version: 1,
      auditEvents: [],
    };

    this.addAudit(ticket, user, 'TICKET_SUBMITTED', TicketStatus.CREATED, ticket.status);
    const saved = await this.persist(ticket, { isNew: true });
    void this.analysisQueue.enqueue(saved.id);
    await this.notify((n) => n.notifyHelpdesk({ kind: 'ticket-submitted', ticket: saved, message: 'New ticket awaiting review.' }, user.id));
    return this.present(saved);
  }

  // Plan B when the AI failed: Helpdesk can ask for the analysis to be run again.
  async retryAnalysis(id: string, user: AuthenticatedUser): Promise<TicketView> {
    this.assertHelpdesk(user);
    const ticket = await this.get(id);
    if (ticket.aiResult?.source === 'pending') {
      throw new ConflictException('The AI is already analysing this ticket');
    }

    ticket.aiResult = { source: 'pending', requestedAt: new Date().toISOString() };
    await this.ticketRepository.update({ id }, { aiResult: ticket.aiResult });
    await this.auditService.record({
      category: 'ticket',
      action: 'AI_ANALYSIS_REQUESTED',
      actor: user,
      target: { type: 'ticket', id },
      summary: `Asked the AI to analyse "${truncate(ticket.title, 80)}" again`,
    });
    void this.analysisQueue.enqueue(id);
    return this.present(ticket);
  }

  async list(user: AuthenticatedUser, priority?: Priority): Promise<TicketView[]> {
    const tickets = (await this.ticketRepository.find({ order: { createdAt: 'DESC' } })).filter((ticket) => {
      if (user.role === 'helpdesk' || user.role === 'administrator') return true;
      return ticket.requesterId === user.id || ticket.assigneeId === user.id;
    });

    return this.presentAll(priority ? tickets.filter((ticket) => ticket.priority === priority) : tickets, user);
  }

  // Records that the user opened the ticket's details, clearing its "new" highlight for them.
  async markViewed(id: string, user: AuthenticatedUser): Promise<{ viewedAt: string }> {
    const ticket = await this.get(id);
    this.assertCanRead(ticket, user);
    return this.recordView(ticket.id, user.id);
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<TicketView> {
    const ticket = await this.get(id);
    this.assertCanRead(ticket, user);
    return this.present(ticket);
  }

  async approve(id: string, dto: SetPriorityDto, user: AuthenticatedUser): Promise<TicketView> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    this.assertStatus(ticket, TicketStatus.PENDING_HELPDESK_REVIEW);
    ticket.priority = dto.priority;
    this.transition(ticket, user, TicketStatus.APPROVED, 'TICKET_APPROVED');
    const saved = await this.persist(ticket);
    await this.notify((n) => n.notifyUser(saved.requesterId, { kind: 'ticket-approved', ticket: saved, message: `Approved with ${saved.priority} priority.` }, user.id));
    return this.present(saved);
  }

  async reject(id: string, dto: RejectTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    this.assertStatus(ticket, TicketStatus.PENDING_HELPDESK_REVIEW);
    ticket.rejectionReason = dto.reason;
    this.transition(ticket, user, TicketStatus.REJECTED, 'TICKET_REJECTED', dto.reason);
    const saved = await this.persist(ticket);
    await this.notify((n) => n.notifyUser(saved.requesterId, { kind: 'ticket-rejected', ticket: saved, message: `Rejected: ${dto.reason}` }, user.id));
    return this.present(saved);
  }

  async setPriority(id: string, dto: SetPriorityDto, user: AuthenticatedUser): Promise<TicketView> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    if (![TicketStatus.APPROVED, TicketStatus.ASSIGNED].includes(ticket.status)) {
      throw new ConflictException('Priority can only be changed after approval and before work starts');
    }
    ticket.priority = dto.priority;
    this.touch(ticket);
    this.addAudit(ticket, user, 'PRIORITY_CHANGED');
    return this.present(await this.persist(ticket));
  }

  async assign(id: string, dto: AssignTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    this.assertStatus(ticket, TicketStatus.APPROVED);
    const assignee = await this.userRepository.findOneBy({ id: dto.assigneeId });
    if (!assignee || assignee.status !== 'active') {
      throw new BadRequestException('The selected assignee does not exist or is not active');
    }
    const now = new Date();
    ticket.assigneeId = dto.assigneeId;
    ticket.assignedAt = now.toISOString();
    ticket.expectedDurationHours = dto.expectedDurationHours;
    this.transition(ticket, user, TicketStatus.ASSIGNED, 'TICKET_ASSIGNED');
    const saved = await this.persist(ticket);
    await this.notify((n) =>
      n.notifyUser(saved.assigneeId, {
        kind: 'ticket-assigned',
        ticket: saved,
        message: `Assigned to you. Expected duration: ${saved.expectedDurationHours}h.`,
        dedupeKey: `ticket-assigned:${saved.id}:${saved.assignedAt}`,
      }, user.id),
    );
    return this.present(saved);
  }

  async claim(id: string, user: AuthenticatedUser): Promise<TicketView> {
    const ticket = await this.get(id);
    if (user.role !== 'employee' && user.role !== 'assignee' && user.role !== 'administrator') {
      throw new ForbiddenException('Only the selected assignee can claim a ticket');
    }
    if (user.role !== 'administrator' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('Only the selected assignee can claim this ticket');
    }
    this.assertStatus(ticket, TicketStatus.ASSIGNED);
    const now = new Date();
    ticket.claimedAt = now.toISOString();
    ticket.dueAt = new Date(now.getTime() + (ticket.expectedDurationHours ?? 0) * 60 * 60 * 1000).toISOString();
    this.transition(ticket, user, TicketStatus.IN_PROGRESS, 'TICKET_CLAIMED');
    const saved = await this.persist(ticket);
    // Claiming means the assignee has seen the ticket.
    await this.recordView(saved.id, user.id);
    return this.present(saved);
  }

  async resolve(id: string, dto: ResolveTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const ticket = await this.get(id);
    if (user.role !== 'employee' && user.role !== 'assignee' && user.role !== 'administrator') {
      throw new ForbiddenException('Only the assignee can resolve a ticket');
    }
    if (user.role !== 'administrator' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('Only the assigned user can resolve this ticket');
    }
    this.assertStatus(ticket, TicketStatus.IN_PROGRESS);
    ticket.resolvedAt = new Date().toISOString();
    ticket.resolutionFeedback = dto.feedback;
    this.transition(ticket, user, TicketStatus.RESOLVED, 'TICKET_RESOLVED');
    const saved = await this.persist(ticket);
    await this.notify(async (n) => {
      await n.notifyHelpdesk({ kind: 'ticket-resolved', ticket: saved, message: `Resolved: ${dto.feedback}` }, user.id);
      // Only when someone else resolved it: the assignee is never told about their own resolution.
      await n.notifyUser(saved.requesterId, { kind: 'ticket-resolved', ticket: saved, message: 'Your ticket has been resolved.' }, user.id);
    });
    return this.present(saved);
  }

  // The ticket's workflow history (no sign-in or security entries), with actor names, oldest first.
  async auditEvents(id: string, user: AuthenticatedUser): Promise<Array<AuditEvent & { actorName?: string }>> {
    const ticket = await this.get(id);
    this.assertCanRead(ticket, user);
    return this.auditService.withActorNames(ticket.auditEvents ?? []);
  }

  // The workflow change is already saved; a failed notification is logged, not surfaced to the caller.
  private async notify(send: (notifications: NotificationsService) => Promise<void>): Promise<void> {
    try {
      await send(this.notificationsService);
    } catch (error) {
      this.logger.error(`Notification could not be stored: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async present(ticket: Ticket): Promise<TicketView> {
    return (await this.presentAll([ticket]))[0];
  }

  private async presentAll(tickets: Ticket[], viewer?: AuthenticatedUser): Promise<TicketView[]> {
    const ids = [...new Set(tickets.flatMap((ticket) => [ticket.requesterId, ticket.assigneeId]).filter((id): id is string => !!id))];
    const users = ids.length > 0 ? await this.userRepository.findBy({ id: In(ids) }) : [];
    const names = new Map(users.map((user) => [user.id, fullName(user)]));
    const views = viewer ? await this.viewRepository.findBy({ userId: viewer.id }) : [];
    const viewedAt = new Map(views.map((view) => [view.ticketId, view.viewedAt]));

    return tickets.map((ticket) => ({
      ...ticket,
      requesterName: names.get(ticket.requesterId),
      assigneeName: ticket.assigneeId ? names.get(ticket.assigneeId) : undefined,
      viewedAt: viewer ? viewedAt.get(ticket.id) : undefined,
    }));
  }

  private async recordView(ticketId: string, userId: string): Promise<{ viewedAt: string }> {
    const viewedAt = new Date().toISOString();
    await this.viewRepository.upsert({ userId, ticketId, viewedAt }, ['userId', 'ticketId']);
    return { viewedAt };
  }

  async listComments(id: string, user: AuthenticatedUser): Promise<TicketComment[]> {
    const ticket = await this.get(id);
    this.assertCanRead(ticket, user);
    const comments = await this.commentRepository.find({ where: { ticketId: id }, order: { createdAt: 'ASC' } });
    return this.presentComments(comments);
  }

  // Anyone involved in the ticket (requester, assignee, Helpdesk) can comment until it is closed.
  async addComment(id: string, dto: AddCommentDto, user: AuthenticatedUser): Promise<TicketComment> {
    const ticket = await this.get(id);
    this.assertCanRead(ticket, user);
    if (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.REJECTED) {
      throw new ConflictException(`Comments are closed because the ticket is ${ticket.status}`);
    }

    const comment = await this.commentRepository.save({
      id: randomUUID(),
      ticketId: ticket.id,
      authorId: user.id,
      body: dto.body.trim(),
      createdAt: new Date().toISOString(),
    });
    this.addAudit(ticket, user, 'COMMENT_ADDED');
    await this.persist(ticket);

    const [presented] = await this.presentComments([comment]);
    const draft = {
      kind: 'ticket-comment' as const,
      ticket,
      message: `${presented.authorName ?? 'Someone'}: ${truncate(comment.body, 140)}`,
      dedupeKey: `ticket-comment:${comment.id}`,
    };
    await this.notify(async (n) => {
      await n.notifyHelpdesk(draft, user.id);
      for (const participant of new Set([ticket.requesterId, ticket.assigneeId])) {
        await n.notifyUser(participant, draft, user.id);
      }
    });

    return presented;
  }

  private async presentComments(comments: TicketCommentEntity[]): Promise<TicketComment[]> {
    const authorIds = [...new Set(comments.map((comment) => comment.authorId))];
    const authors = authorIds.length > 0 ? await this.userRepository.findBy({ id: In(authorIds) }) : [];
    const byId = new Map(authors.map((author) => [author.id, author]));

    return comments.map((comment) => {
      const author = byId.get(comment.authorId);
      return { ...comment, authorName: author ? fullName(author) : undefined, authorRole: author?.role };
    });
  }

  private async get(id: string): Promise<TicketEntity> {
    const ticket = await this.ticketRepository.findOneBy({ id });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  private assertCanRead(ticket: Ticket, user: AuthenticatedUser): void {
    const allowed = user.role === 'helpdesk' || user.role === 'administrator' || ticket.requesterId === user.id || ticket.assigneeId === user.id;
    if (!allowed) throw new ForbiddenException('You are not authorized to view this ticket');
  }

  private assertHelpdesk(user: AuthenticatedUser): void {
    if (user.role !== 'helpdesk' && user.role !== 'administrator') {
      throw new ForbiddenException('Only Helpdesk can perform this action');
    }
  }

  private assertStatus(ticket: Ticket, expected: TicketStatus): void {
    if (ticket.status !== expected) {
      throw new ConflictException(`Ticket must be ${expected}`);
    }
  }

  private transition(ticket: Ticket, actor: AuthenticatedUser, status: TicketStatus, action: string, reason?: string): void {
    const previous = ticket.status;
    ticket.status = status;
    this.touch(ticket);
    this.addAudit(ticket, actor, action, previous, status, reason);
  }

  private addAudit(ticket: Ticket, actor: AuthenticatedUser, action: string, oldStatus?: TicketStatus, newStatus?: TicketStatus, reason?: string): void {
    const event: AuditEvent = { id: randomUUID(), ticketId: ticket.id, actorId: actor.id, action, oldStatus, newStatus, reason, timestamp: new Date().toISOString() };
    ticket.auditEvents.push(event);
    this.pendingAudit.set(ticket, [...(this.pendingAudit.get(ticket) ?? []), { event, actor }]);
  }

  // Saves the ticket (its own history is stored with it atomically), then mirrors the new events
  // into the system-wide audit log used by the Helpdesk activity log.
  // Workflow saves never write `aiResult`: the background analysis may have updated it since the ticket was
  // loaded, and a full save would put the stale value back. Only a brand-new ticket writes it.
  private async persist(ticket: Ticket, { isNew = false }: { isNew?: boolean } = {}): Promise<TicketEntity> {
    const toSave = isNew ? ticket : { ...ticket, aiResult: undefined };
    const saved = await this.ticketRepository.save(toSave as TicketEntity);
    saved.aiResult = ticket.aiResult;
    const pending = this.pendingAudit.get(ticket) ?? [];
    this.pendingAudit.delete(ticket);

    for (const { event, actor } of pending) {
      await this.auditService.record({
        category: 'ticket',
        action: event.action,
        actor,
        target: { type: 'ticket', id: saved.id },
        summary: await this.describeTicketEvent(event.action, saved, event.reason),
        details: { oldStatus: event.oldStatus ?? null, newStatus: event.newStatus ?? null, priority: saved.priority ?? null },
      });
    }
    return saved;
  }

  private async describeTicketEvent(action: string, ticket: Ticket, reason?: string): Promise<string> {
    const title = `"${truncate(ticket.title, 80)}"`;
    switch (action) {
      case 'TICKET_SUBMITTED':
        return `Submitted ${title}`;
      case 'TICKET_APPROVED':
        return `Approved ${title} with ${ticket.priority} priority`;
      case 'TICKET_REJECTED':
        return `Rejected ${title}: ${truncate(reason ?? '', 160)}`;
      case 'PRIORITY_CHANGED':
        return `Changed priority of ${title} to ${ticket.priority}`;
      case 'TICKET_ASSIGNED': {
        const assignee = ticket.assigneeId ? await this.userRepository.findOneBy({ id: ticket.assigneeId }) : null;
        return `Assigned ${title} to ${assignee ? fullName(assignee) : ticket.assigneeId} (${ticket.expectedDurationHours}h)`;
      }
      case 'TICKET_CLAIMED':
        return `Claimed ${title}; work timer started`;
      case 'TICKET_RESOLVED':
        return `Resolved ${title}`;
      case 'COMMENT_ADDED':
        return `Commented on ${title}`;
      default:
        return `${action} on ${title}`;
    }
  }

  private touch(ticket: Ticket): void {
    ticket.updatedAt = new Date().toISOString();
    ticket.version += 1;
  }
}

function fullName(user: Pick<UserEntity, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
