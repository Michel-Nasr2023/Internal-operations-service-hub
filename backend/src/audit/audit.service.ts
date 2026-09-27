import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, LessThan, Like, Repository } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { TicketEntity } from '../tickets/ticket.entity';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { AuditCategory, AuditLogEntity, AuditOutcome } from './audit-log.entity';
import { currentRequestContext } from './request-context';

export interface AuditEntryInput {
  category: AuditCategory;
  action: string;
  outcome?: AuditOutcome;
  actor?: Pick<AuthenticatedUser, 'id' | 'role'> | null;
  target?: { type: 'ticket' | 'user'; id: string };
  summary: string;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export interface AuditLogQuery {
  category?: AuditCategory;
  outcome?: AuditOutcome;
  search?: string;
  before?: string;
  limit?: number;
}

export type AuditLogView = AuditLogEntity & { actorName?: string };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLogEntity) private readonly auditRepository: Repository<AuditLogEntity>,
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.backfillTicketHistory();
  }

  // Never throws: a failed audit write is logged to the server log but does not break the user's action.
  async record(entry: AuditEntryInput): Promise<void> {
    const context = currentRequestContext();
    const details = entry.details
      ? Object.fromEntries(Object.entries(entry.details).filter(([, value]) => value !== undefined))
      : null;

    try {
      await this.auditRepository.insert({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        category: entry.category,
        action: entry.action,
        outcome: entry.outcome ?? 'success',
        actorId: entry.actor?.id ?? null,
        actorRole: entry.actor?.role ?? null,
        targetType: entry.target?.type ?? null,
        targetId: entry.target?.id ?? null,
        summary: entry.summary.slice(0, 500),
        details: details as AuditLogEntity['details'],
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      });
    } catch (error) {
      this.logger.error(`Audit entry "${entry.action}" could not be stored: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Newest first. `before` is the timestamp of the last row already shown, for "Load more".
  async list(query: AuditLogQuery): Promise<{ items: AuditLogView[]; nextBefore?: string }> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const base = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.before ? { timestamp: LessThan(query.before) } : {}),
    };
    const term = query.search?.trim();
    // Search matches the summary, action, or target ID.
    const where = term
      ? [
          { ...base, summary: Like(`%${term}%`) },
          { ...base, action: Like(`%${term.toUpperCase()}%`) },
          { ...base, targetId: Like(`%${term}%`) },
        ]
      : base;

    const rows = await this.auditRepository.find({ where, order: { timestamp: 'DESC' }, take: limit + 1 });
    const page = rows.slice(0, limit);
    return {
      items: await this.withActorNames(page),
      nextBefore: rows.length > limit ? page[page.length - 1].timestamp : undefined,
    };
  }

  async withActorNames<T extends { actorId?: string | null }>(rows: T[]): Promise<Array<T & { actorName?: string }>> {
    const ids = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => !!id))];
    const users = ids.length > 0 ? await this.userRepository.findBy({ id: In(ids) }) : [];
    const names = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
    return rows.map((row) => ({ ...row, actorName: row.actorId ? names.get(row.actorId) : undefined }));
  }

  // One-time copy of ticket history recorded before this table existed, so the activity log is complete.
  private async backfillTicketHistory(): Promise<void> {
    try {
      if ((await this.auditRepository.count()) > 0) return;
      const tickets = await this.ticketRepository.find();
      const rows = tickets.flatMap((ticket) =>
        (ticket.auditEvents ?? []).map((event) => ({
          id: event.id,
          timestamp: event.timestamp,
          category: 'ticket' as const,
          action: event.action,
          outcome: 'success' as const,
          actorId: event.actorId,
          actorRole: null,
          targetType: 'ticket' as const,
          targetId: ticket.id,
          summary: `${event.action.replace(/_/g, ' ').toLowerCase()} · "${ticket.title}"`.slice(0, 500),
          details: { oldStatus: event.oldStatus ?? null, newStatus: event.newStatus ?? null, backfilled: true },
          ip: null,
          userAgent: null,
          requestId: null,
        })),
      );
      for (let index = 0; index < rows.length; index += 200) {
        await this.auditRepository.insert(rows.slice(index, index + 200));
      }
      if (rows.length > 0) this.logger.log(`Backfilled ${rows.length} ticket history entries into the audit log.`);
    } catch (error) {
      this.logger.error(`Audit backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
