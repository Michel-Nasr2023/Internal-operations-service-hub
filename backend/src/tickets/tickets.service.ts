import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AssignTicketDto, CreateTicketDto, RejectTicketDto, SetPriorityDto } from './ticket.dto';
import { TicketEntity } from './ticket.entity';
import { AuthenticatedUser, AuditEvent, Priority, Ticket, TicketStatus } from './ticket.types';

@Injectable()
export class TicketsService {
  constructor(@InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>) {}

  async create(dto: CreateTicketDto, user: AuthenticatedUser): Promise<Ticket> {
    const now = new Date().toISOString();
    const ticket: Ticket = {
      id: randomUUID(),
      requesterId: user.id,
      teamId: dto.teamId,
      issueType: dto.issueType,
      project: dto.project,
      title: dto.title,
      description: dto.description,
      status: TicketStatus.PENDING_HELPDESK_REVIEW,
      createdAt: now,
      updatedAt: now,
      version: 1,
      auditEvents: [],
    };

    this.addAudit(ticket, user.id, 'TICKET_SUBMITTED', TicketStatus.CREATED, ticket.status);
    return this.ticketRepository.save(ticket);
  }

  async list(user: AuthenticatedUser, priority?: Priority): Promise<Ticket[]> {
    const tickets = (await this.ticketRepository.find()).filter((ticket) => {
      if (user.role === 'helpdesk' || user.role === 'administrator') return true;
      if (user.role === 'assignee') return ticket.assigneeId === user.id;
      return ticket.requesterId === user.id;
    });

    return priority ? tickets.filter((ticket) => ticket.priority === priority) : tickets;
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.get(id);
    this.assertCanRead(ticket, user);
    return ticket;
  }

  async approve(id: string, dto: SetPriorityDto, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    this.assertStatus(ticket, TicketStatus.PENDING_HELPDESK_REVIEW);
    ticket.priority = dto.priority;
    this.transition(ticket, user.id, TicketStatus.APPROVED, 'TICKET_APPROVED');
    return this.ticketRepository.save(ticket);
  }

  async reject(id: string, dto: RejectTicketDto, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    this.assertStatus(ticket, TicketStatus.PENDING_HELPDESK_REVIEW);
    ticket.rejectionReason = dto.reason;
    this.transition(ticket, user.id, TicketStatus.REJECTED, 'TICKET_REJECTED', dto.reason);
    return this.ticketRepository.save(ticket);
  }

  async setPriority(id: string, dto: SetPriorityDto, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    if (![TicketStatus.APPROVED, TicketStatus.ASSIGNED].includes(ticket.status)) {
      throw new ConflictException('Priority can only be changed after approval and before work starts');
    }
    ticket.priority = dto.priority;
    this.touch(ticket);
    this.addAudit(ticket, user.id, 'PRIORITY_CHANGED');
    return this.ticketRepository.save(ticket);
  }

  async assign(id: string, dto: AssignTicketDto, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.get(id);
    this.assertHelpdesk(user);
    this.assertStatus(ticket, TicketStatus.APPROVED);
    const now = new Date();
    ticket.assigneeId = dto.assigneeId;
    ticket.assignedAt = now.toISOString();
    ticket.expectedDurationHours = dto.expectedDurationHours;
    this.transition(ticket, user.id, TicketStatus.ASSIGNED, 'TICKET_ASSIGNED');
    return this.ticketRepository.save(ticket);
  }

  async claim(id: string, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.get(id);
    if (user.role !== 'assignee' && user.role !== 'administrator') {
      throw new ForbiddenException('Only the selected assignee can claim a ticket');
    }
    if (user.role !== 'administrator' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('Only the selected assignee can claim this ticket');
    }
    this.assertStatus(ticket, TicketStatus.ASSIGNED);
    const now = new Date();
    ticket.claimedAt = now.toISOString();
    ticket.dueAt = new Date(now.getTime() + (ticket.expectedDurationHours ?? 0) * 60 * 60 * 1000).toISOString();
    this.transition(ticket, user.id, TicketStatus.IN_PROGRESS, 'TICKET_CLAIMED');
    return this.ticketRepository.save(ticket);
  }

  async resolve(id: string, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.get(id);
    if (user.role !== 'assignee' && user.role !== 'administrator') {
      throw new ForbiddenException('Only the assignee can resolve a ticket');
    }
    if (user.role !== 'administrator' && ticket.assigneeId !== user.id) {
      throw new ForbiddenException('Only the assigned user can resolve this ticket');
    }
    this.assertStatus(ticket, TicketStatus.IN_PROGRESS);
    ticket.resolvedAt = new Date().toISOString();
    this.transition(ticket, user.id, TicketStatus.RESOLVED, 'TICKET_RESOLVED');
    return this.ticketRepository.save(ticket);
  }

  async auditEvents(id: string, user: AuthenticatedUser): Promise<AuditEvent[]> {
    return (await this.findOne(id, user)).auditEvents;
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

  private transition(ticket: Ticket, actorId: string, status: TicketStatus, action: string, reason?: string): void {
    const previous = ticket.status;
    ticket.status = status;
    this.touch(ticket);
    this.addAudit(ticket, actorId, action, previous, status, reason);
  }

  private addAudit(ticket: Ticket, actorId: string, action: string, oldStatus?: TicketStatus, newStatus?: TicketStatus, reason?: string): void {
    ticket.auditEvents.push({ id: randomUUID(), ticketId: ticket.id, actorId, action, oldStatus, newStatus, reason, timestamp: new Date().toISOString() });
  }

  private touch(ticket: Ticket): void {
    ticket.updatedAt = new Date().toISOString();
    ticket.version += 1;
  }
}
