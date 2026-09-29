import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { FindOptionsSelect, In, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { AddCommentDto, ApproveTicketDto, AssignTicketDto, CreateTicketDto, RejectTicketDto, ResolveTicketDto, SetPriorityDto } from './ticket.dto';
import { TicketEntity } from './ticket.entity';
import { AuthenticatedUser, AuditEvent, Priority, Ticket, TicketComment, TicketStatus, TicketView } from './ticket.types';
import { TicketCommentEntity } from './ticket-comment.entity';
import { TicketViewEntity } from './ticket-view.entity';
import { TicketAttachmentEntity } from './ticket-attachment.entity';
import { TicketAnalysisQueue } from './ticket-analysis.queue';
import { UserEntity } from '../auth/user.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { describeError, ticketRef } from '../common/log-safe';

// How many times an action is re-run when other people keep saving the same ticket at the same moment.
const MAX_SAVE_ATTEMPTS = 3;

// The ticket was saved by someone else after it was read; change() retries on the latest copy.
class TicketChangedMeanwhile extends Error {}

@Injectable()
export class TicketsService implements OnModuleInit {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(TicketCommentEntity) private readonly commentRepository: Repository<TicketCommentEntity>,
    @InjectRepository(TicketViewEntity) private readonly viewRepository: Repository<TicketViewEntity>,
    @InjectRepository(TicketAttachmentEntity) private readonly attachmentRepository: Repository<TicketAttachmentEntity>,
    private readonly analysisQueue: TicketAnalysisQueue,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  // Tickets handled before "reviewed by" / "assigned by" were stored get them from their own history.
  // Only tickets still missing one of them are loaded, so start-up stays quick as the table grows.
  async onModuleInit(): Promise<void> {
    try {
      const tickets = await this.ticketRepository.find({ where: [{ reviewedBy: IsNull() }, { assignedBy: IsNull(), assigneeId: Not(IsNull()) }] });
      for (const ticket of tickets) {
        const events = ticket.auditEvents ?? [];
        const lastOf = (...actions: string[]) => [...events].reverse().find((event) => actions.includes(event.action));
        const changes: Partial<TicketEntity> = {};

        const review = lastOf('TICKET_APPROVED', 'TICKET_REJECTED');
        if (!ticket.reviewedBy && review) {
          changes.reviewedBy = review.actorId;
          changes.reviewedAt = review.timestamp;
        }
        const assignment = lastOf('TICKET_ASSIGNED', 'TICKET_REASSIGNED');
        if (!ticket.assignedBy && ticket.assigneeId && assignment) changes.assignedBy = assignment.actorId;

        if (Object.keys(changes).length > 0) await this.ticketRepository.update({ id: ticket.id }, changes);
      }
    } catch (error) {
      this.logger.error(`Could not fill in reviewer/assigner history: ${describeError(error)}`);
    }
  }

  // Audit events added since the ticket was loaded; written to the system audit log after the ticket saves.
  private readonly pendingAudit = new WeakMap<Ticket, Array<{ event: AuditEvent; actor: AuthenticatedUser }>>();

  // Saves immediately; the AI analysis runs afterwards in the background (see TicketAnalysisQueue).
  // With a `submissionKey`, sending the same submission again returns the ticket it already created (no copy,
  // no second round of notifications), even when both copies arrive at the same moment.
  async create(dto: CreateTicketDto, user: AuthenticatedUser, submissionKey?: string): Promise<TicketView> {
    if (submissionKey) {
      const earlier = await this.ticketRepository.findOneBy({ requesterId: user.id, submissionKey });
      if (earlier) return this.present(earlier);
    }

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
      submissionKey,
    };

    this.addAudit(ticket, user, 'TICKET_SUBMITTED', TicketStatus.CREATED, ticket.status);
    let saved: TicketEntity;
    try {
      saved = await this.persist(ticket, { isNew: true });
    } catch (error) {
      // The same submission was saved a moment ago by a parallel request: answer with that ticket.
      const earlier = submissionKey && isUniqueViolation(error) ? await this.ticketRepository.findOneBy({ requesterId: user.id, submissionKey }) : null;
      if (earlier) return this.present(earlier);
      throw error;
    }
    void this.analysisQueue.enqueue(saved.id);
    await this.notify((n) => n.notifyHelpdesk({ kind: 'ticket-submitted', ticket: saved, message: 'New ticket awaiting review.' }, user.id));
    return this.present(saved);
  }

  // Adds a workflow-history entry that is not a status change (e.g. files attached), and mirrors it to the audit log.
  async recordHistory(ticketId: string, user: AuthenticatedUser, action: string, reason?: string): Promise<void> {
    await this.change(ticketId, (ticket) => this.addAudit(ticket, user, action, undefined, undefined, reason));
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
      summary: `Asked the AI to analyse ${ticketRef(ticket.id)} again`,
    });
    void this.analysisQueue.enqueue(id);
    return this.present(ticket);
  }

  // Filtered in the database (employees: only tickets they requested or are assigned), without the history column.
  async list(user: AuthenticatedUser, priority?: Priority): Promise<TicketView[]> {
    const staff = user.role === 'helpdesk' || user.role === 'administrator';
    const byPriority = priority ? { priority } : {};
    const tickets = await this.ticketRepository.find({
      select: this.listColumns(),
      where: staff ? byPriority : [{ requesterId: user.id, ...byPriority }, { assigneeId: user.id, ...byPriority }],
      order: { createdAt: 'DESC' },
    });
    return this.presentAll(tickets, user);
  }

  // Every ticket column except the workflow history, which lists never show.
  private listColumns(): FindOptionsSelect<TicketEntity> {
    return Object.fromEntries(
      this.ticketRepository.metadata.columns.filter((column) => column.propertyName !== 'auditEvents').map((column) => [column.propertyName, true]),
    ) as FindOptionsSelect<TicketEntity>;
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

  // With `assigneeId` + `expectedDurationHours`, approves and assigns in one save: either both happen or neither.
  async approve(id: string, dto: ApproveTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const assigning = dto.assigneeId !== undefined || dto.expectedDurationHours !== undefined;
    const saved = await this.change(id, async (ticket) => {
      this.assertHelpdesk(user);
      this.assertStatus(ticket, TicketStatus.PENDING_HELPDESK_REVIEW);
      if (assigning && (!dto.assigneeId || !dto.expectedDurationHours)) {
        throw new BadRequestException('To assign while approving, give both an assignee and the expected hours');
      }
      // Everything is checked before the ticket changes, so a bad assignee cannot leave it half-updated.
      if (assigning) await this.assertAssignable(dto.assigneeId!);

      ticket.priority = dto.priority;
      this.markReviewed(ticket, user);
      this.transition(ticket, user, TicketStatus.APPROVED, 'TICKET_APPROVED');
      if (assigning) this.applyAssignment(ticket, user, dto.assigneeId!, dto.expectedDurationHours!);
    });

    const reviewer = await this.nameOf(user.id);
    await this.notify((n) =>
      n.notifyUser(saved.requesterId, { kind: 'ticket-approved', ticket: saved, message: `Approved by ${reviewer} with ${saved.priority} priority.` }, user.id),
    );
    if (assigning) await this.notifyAssignee(saved, user);
    return this.present(saved);
  }

  async reject(id: string, dto: RejectTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const saved = await this.change(id, (ticket) => {
      this.assertHelpdesk(user);
      this.assertStatus(ticket, TicketStatus.PENDING_HELPDESK_REVIEW);
      ticket.rejectionReason = dto.reason;
      this.markReviewed(ticket, user);
      this.transition(ticket, user, TicketStatus.REJECTED, 'TICKET_REJECTED', dto.reason);
    });
    const reviewer = await this.nameOf(user.id);
    await this.notify((n) => n.notifyUser(saved.requesterId, { kind: 'ticket-rejected', ticket: saved, message: `Rejected by ${reviewer}: ${dto.reason}` }, user.id));
    return this.present(saved);
  }

  async setPriority(id: string, dto: SetPriorityDto, user: AuthenticatedUser): Promise<TicketView> {
    const saved = await this.change(id, (ticket) => {
      this.assertHelpdesk(user);
      if (![TicketStatus.APPROVED, TicketStatus.ASSIGNED].includes(ticket.status)) {
        throw new ConflictException('Priority can only be changed after approval and before work starts');
      }
      ticket.priority = dto.priority;
      this.touch(ticket);
      this.addAudit(ticket, user, 'PRIORITY_CHANGED');
    });
    return this.present(saved);
  }

  async assign(id: string, dto: AssignTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const saved = await this.change(id, async (ticket) => {
      this.assertHelpdesk(user);
      this.assertStatus(ticket, TicketStatus.APPROVED);
      await this.assertAssignable(dto.assigneeId);
      this.applyAssignment(ticket, user, dto.assigneeId, dto.expectedDurationHours);
    });
    await this.notifyAssignee(saved, user);
    return this.present(saved);
  }

  // Moves every Assigned / In Progress ticket held by `fromUserId`, e.g. before their account is disabled.
  // `reassign`: to another active employee, who must claim it again (the work timer restarts).
  // `queue`: back to Helpdesk as Approved and unassigned.
  async handOverAssignments(
    fromUserId: string,
    target: { mode: 'reassign'; toUserId: string } | { mode: 'queue' },
    actor: AuthenticatedUser,
    reason: string,
  ): Promise<{ moved: number }> {
    if (target.mode === 'reassign') {
      if (target.toUserId === fromUserId) throw new BadRequestException('Choose a different person to take over the tickets');
      const recipient = await this.userRepository.findOneBy({ id: target.toUserId });
      if (!recipient || recipient.status !== 'active' || recipient.role !== 'employee') {
        throw new BadRequestException('Tickets can only be handed to an active employee');
      }
    }

    const held = await this.ticketRepository.find({
      select: { id: true },
      where: [
        { assigneeId: fromUserId, status: TicketStatus.ASSIGNED },
        { assigneeId: fromUserId, status: TicketStatus.IN_PROGRESS },
      ],
    });

    let moved = 0;
    for (const { id } of held) {
      const saved = await this.changeIf(id, (ticket) => {
        // Checked again on the latest copy: the assignee may have resolved it a moment ago.
        if (ticket.assigneeId !== fromUserId || ![TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS].includes(ticket.status)) return false;

        // Explicit nulls: workflow saves skip undefined fields, so this is how the claim is cleared.
        const clear = ticket as unknown as Record<'claimedAt' | 'dueAt', string | null>;
        clear.claimedAt = null;
        clear.dueAt = null;

        if (target.mode === 'reassign') {
          ticket.assigneeId = target.toUserId;
          ticket.assignedAt = new Date().toISOString();
          ticket.assignedBy = actor.id;
          if (ticket.status === TicketStatus.IN_PROGRESS) {
            this.transition(ticket, actor, TicketStatus.ASSIGNED, 'TICKET_REASSIGNED', reason);
          } else {
            this.touch(ticket);
            this.addAudit(ticket, actor, 'TICKET_REASSIGNED', undefined, undefined, reason);
          }
        } else {
          const unassign = ticket as unknown as Record<'assigneeId' | 'assignedAt' | 'assignedBy', string | null> & { expectedDurationHours: number | null };
          unassign.assigneeId = null;
          unassign.assignedAt = null;
          unassign.assignedBy = null;
          unassign.expectedDurationHours = null;
          this.transition(ticket, actor, TicketStatus.APPROVED, 'TICKET_RETURNED_TO_QUEUE', reason);
        }
        return true;
      });
      if (!saved) continue;
      moved += 1;
      if (target.mode === 'reassign') await this.notifyAssignee(saved, actor);
    }
    return { moved };
  }

  async countActiveAssignments(userId: string): Promise<number> {
    return this.ticketRepository.count({
      where: [
        { assigneeId: userId, status: TicketStatus.ASSIGNED },
        { assigneeId: userId, status: TicketStatus.IN_PROGRESS },
      ],
    });
  }

  private async assertAssignable(assigneeId: string): Promise<void> {
    const assignee = await this.userRepository.findOneBy({ id: assigneeId });
    if (!assignee || assignee.status !== 'active') {
      throw new BadRequestException('The selected assignee does not exist or is not active');
    }
  }

  private applyAssignment(ticket: Ticket, user: AuthenticatedUser, assigneeId: string, expectedDurationHours: number): void {
    ticket.assigneeId = assigneeId;
    ticket.assignedAt = new Date().toISOString();
    ticket.assignedBy = user.id;
    ticket.expectedDurationHours = expectedDurationHours;
    this.transition(ticket, user, TicketStatus.ASSIGNED, 'TICKET_ASSIGNED');
  }

  private markReviewed(ticket: Ticket, user: AuthenticatedUser): void {
    ticket.reviewedBy = user.id;
    ticket.reviewedAt = new Date().toISOString();
  }

  private async nameOf(userId: string): Promise<string> {
    const person = await this.userRepository.findOneBy({ id: userId });
    return person ? fullName(person) : 'Helpdesk';
  }

  private async notifyAssignee(ticket: Ticket, user: AuthenticatedUser): Promise<void> {
    const assigner = await this.nameOf(user.id);
    await this.notify((n) =>
      n.notifyUser(ticket.assigneeId, {
        kind: 'ticket-assigned',
        ticket,
        message: `${assigner} assigned this ticket to you. Expected duration: ${ticket.expectedDurationHours}h.`,
        dedupeKey: `ticket-assigned:${ticket.id}:${ticket.assignedAt}`,
      }, user.id),
    );
  }

  async claim(id: string, user: AuthenticatedUser): Promise<TicketView> {
    const saved = await this.change(id, (ticket) => {
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
    });
    // Claiming means the assignee has seen the ticket.
    await this.recordView(saved.id, user.id);
    return this.present(saved);
  }

  async resolve(id: string, dto: ResolveTicketDto, user: AuthenticatedUser): Promise<TicketView> {
    const saved = await this.change(id, (ticket) => {
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
    });
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
      this.logger.error(`Notification could not be stored: ${describeError(error)}`);
    }
  }

  private async present(ticket: Ticket): Promise<TicketView> {
    return (await this.presentAll([ticket]))[0];
  }

  private async presentAll(tickets: Ticket[], viewer?: AuthenticatedUser): Promise<TicketView[]> {
    const ids = [
      ...new Set(tickets.flatMap((ticket) => [ticket.requesterId, ticket.assigneeId, ticket.reviewedBy, ticket.assignedBy]).filter((id): id is string => !!id)),
    ];
    const users = ids.length > 0 ? await this.userRepository.findBy({ id: In(ids) }) : [];
    const names = new Map(users.map((user) => [user.id, fullName(user)]));
    const avatars = new Map(users.map((user) => [user.id, user.avatarUpdatedAt ?? null]));
    const views = viewer ? await this.viewRepository.findBy({ userId: viewer.id }) : [];
    const viewedAt = new Map(views.map((view) => [view.ticketId, view.viewedAt]));
    const ticketIds = tickets.map((ticket) => ticket.id);
    const attachments = ticketIds.length > 0 ? await this.attachmentRepository.find({ select: { ticketId: true }, where: { ticketId: In(ticketIds) } }) : [];
    const attachmentCounts = new Map<string, number>();
    for (const attachment of attachments) attachmentCounts.set(attachment.ticketId, (attachmentCounts.get(attachment.ticketId) ?? 0) + 1);

    return tickets.map(({ auditEvents: _history, submissionKey: _submissionKey, ...ticket }) => ({
      ...ticket,
      requesterName: names.get(ticket.requesterId),
      assigneeName: ticket.assigneeId ? names.get(ticket.assigneeId) : undefined,
      requesterAvatarUpdatedAt: avatars.get(ticket.requesterId) ?? null,
      assigneeAvatarUpdatedAt: ticket.assigneeId ? avatars.get(ticket.assigneeId) ?? null : null,
      reviewedByName: ticket.reviewedBy ? names.get(ticket.reviewedBy) : undefined,
      reviewedByAvatarUpdatedAt: ticket.reviewedBy ? avatars.get(ticket.reviewedBy) ?? null : null,
      assignedByName: ticket.assignedBy ? names.get(ticket.assignedBy) : undefined,
      assignedByAvatarUpdatedAt: ticket.assignedBy ? avatars.get(ticket.assignedBy) ?? null : null,
      viewedAt: viewer ? viewedAt.get(ticket.id) : undefined,
      attachmentCount: attachmentCounts.get(ticket.id) ?? 0,
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

    const comment: TicketCommentEntity = { id: randomUUID(), ticketId: ticket.id, authorId: user.id, body: dto.body.trim(), createdAt: new Date().toISOString() };
    await this.commentRepository.insert(comment);
    // Only the history entry is added: an approval or claim saved at the same moment is kept, not overwritten.
    await this.change(ticket.id, (latest) => this.addAudit(latest, user, 'COMMENT_ADDED'));

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
      return { ...comment, authorName: author ? fullName(author) : undefined, authorRole: author?.role, authorAvatarUpdatedAt: author?.avatarUpdatedAt ?? null };
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
      throw new ConflictException(
        `This action needs the ticket to be ${statusLabel(expected)}, but it is ${statusLabel(ticket.status)}. Refresh to see its latest state.`,
      );
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

  // Loads the ticket, lets `apply` check and change it, and saves it. If someone else saved the same ticket in
  // between (e.g. two Helpdesk members, or a comment arriving during an approval), nothing is overwritten: the
  // action starts again on the latest copy, so its checks ("must still be Pending") see the current state and
  // fail with their usual clear message when the action no longer applies.
  private async change(id: string, apply: (ticket: TicketEntity) => void | Promise<void>): Promise<TicketEntity> {
    return (await this.changeIf(id, async (ticket) => {
      await apply(ticket);
      return true;
    }))!;
  }

  // Like change(), but `apply` may return false to leave the ticket as it is (the result is then null).
  private async changeIf(id: string, apply: (ticket: TicketEntity) => boolean | Promise<boolean>): Promise<TicketEntity | null> {
    for (let attempt = 1; ; attempt += 1) {
      const ticket = await this.get(id);
      if (!(await apply(ticket))) return null;
      try {
        return await this.persist(ticket);
      } catch (error) {
        if (!(error instanceof TicketChangedMeanwhile)) throw error;
        if (attempt === MAX_SAVE_ATTEMPTS) throw new ConflictException('Someone else is changing this ticket right now. Refresh and try again.');
      }
    }
  }

  // Saves the ticket (its own history is stored with it atomically), then mirrors the new events
  // into the system-wide audit log used by the Helpdesk activity log.
  // An existing ticket is only written if its `version` is still the one that was read (optimistic locking);
  // otherwise TicketChangedMeanwhile is thrown and change() retries on the latest copy.
  // Workflow saves never write `aiResult`: the background analysis may have updated it since the ticket was
  // loaded, and writing it would put the stale value back. Only a brand-new ticket writes it.
  private async persist(ticket: Ticket, { isNew = false }: { isNew?: boolean } = {}): Promise<TicketEntity> {
    let saved: TicketEntity;
    if (isNew) {
      await this.ticketRepository.insert(ticket as TicketEntity);
      saved = ticket as TicketEntity;
    } else {
      const { id, version, aiResult: _aiResult, ...changes } = ticket as TicketEntity;
      const result = await this.ticketRepository.update({ id, version }, { ...changes, version: version + 1 });
      if (!result.affected) throw new TicketChangedMeanwhile();
      ticket.version = version + 1;
      saved = ticket as TicketEntity;
    }
    const pending = this.pendingAudit.get(ticket) ?? [];
    this.pendingAudit.delete(ticket);

    for (const { event, actor } of pending) {
      await this.auditService.record({
        category: 'ticket',
        action: event.action,
        actor,
        target: { type: 'ticket', id: saved.id },
        summary: this.describeTicketEvent(event.action, saved),
        details: { oldStatus: event.oldStatus ?? null, newStatus: event.newStatus ?? null, priority: saved.priority ?? null },
      });
    }
    return saved;
  }

  // Audit-log summary for a ticket event: the ticket and people by ID, never the ticket's title, reasons,
  // comments or file names (those stay on the ticket, visible to the people allowed to see it).
  private describeTicketEvent(action: string, ticket: Ticket): string {
    const ref = ticketRef(ticket.id);
    switch (action) {
      case 'TICKET_SUBMITTED':
        return `Submitted ${ref}`;
      case 'TICKET_APPROVED':
        return `Approved ${ref} with ${ticket.priority} priority`;
      case 'TICKET_REJECTED':
        return `Rejected ${ref} (reason recorded on the ticket)`;
      case 'PRIORITY_CHANGED':
        return `Changed priority of ${ref} to ${ticket.priority}`;
      case 'TICKET_ASSIGNED':
        return `Assigned ${ref} to user ${ticket.assigneeId} (${ticket.expectedDurationHours}h)`;
      case 'TICKET_REASSIGNED':
        return `Reassigned ${ref} to user ${ticket.assigneeId}`;
      case 'TICKET_RETURNED_TO_QUEUE':
        return `Returned ${ref} to the Helpdesk queue`;
      case 'TICKET_CLAIMED':
        return `Claimed ${ref}; work timer started`;
      case 'TICKET_RESOLVED':
        return `Resolved ${ref}`;
      case 'COMMENT_ADDED':
        return `Commented on ${ref}`;
      case 'ATTACHMENTS_ADDED':
        return `Attached files to ${ref}`;
      default:
        return `${action} on ${ref}`;
    }
  }

  // The version number itself is raised by persist(), once per save.
  private touch(ticket: Ticket): void {
    ticket.updatedAt = new Date().toISOString();
  }
}

function fullName(user: Pick<UserEntity, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof QueryFailedError && /UNIQUE constraint failed/i.test(error.message);
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

// Short status names, matching what the tables show.
function statusLabel(status: TicketStatus): string {
  return status === TicketStatus.PENDING_HELPDESK_REVIEW ? 'Pending' : status;
}
