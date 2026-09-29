import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RqstyAiService } from '../ai/rqsty-ai.service';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/user.entity';
import { TicketEntity } from './ticket.entity';
import { TicketAiFailure, TicketAiPending } from './ticket.types';

const TEAM_NAMES: Record<string, string> = {
  it: 'IT Operations',
  facilities: 'Facilities',
  finance: 'Finance',
};

// Plan B for AI outages: a temporary failure is tried again automatically after 2, 10 and 30 minutes.
// After that, Helpdesk's "Retry AI analysis" button remains.
const AUTO_RETRY_DELAYS_MS = [2, 10, 30].map((minutes) => minutes * 60 * 1000);
const RETRY_CHECK_INTERVAL_MS = 60 * 1000;

// Runs AI ticket analysis in the background, one ticket at a time. Submission never waits for the AI, and
// running one request at a time keeps us under the provider's concurrent-request limit.
@Injectable()
export class TicketAnalysisQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TicketAnalysisQueue.name);
  private chain: Promise<void> = Promise.resolve();
  private readonly queued = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    private readonly rqstyAiService: RqstyAiService,
    private readonly auditService: AuditService,
  ) {}

  // Tickets left "pending" by a restart are picked up again, and due automatic retries are checked every minute.
  async onModuleInit(): Promise<void> {
    try {
      const pending = await this.ticketRepository
        .createQueryBuilder('ticket')
        .select('ticket.id', 'id')
        .where("json_extract(ticket.aiResult, '$.source') = 'pending'")
        .orderBy('ticket.createdAt', 'ASC')
        .getRawMany<{ id: string }>();
      for (const { id } of pending) void this.enqueue(id);
    } catch (error) {
      this.logger.error(`Could not resume pending AI analyses: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.timer = setInterval(() => void this.retryDueFailures(), RETRY_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Resolves when this ticket's analysis has finished (successfully or not).
  enqueue(ticketId: string): Promise<void> {
    if (this.queued.has(ticketId)) return this.chain;
    this.queued.add(ticketId);
    this.chain = this.chain.then(() => this.process(ticketId));
    return this.chain;
  }

  whenIdle(): Promise<void> {
    return this.chain;
  }

  // Puts failed analyses whose automatic retry is due back in the queue. Never throws.
  async retryDueFailures(now = new Date()): Promise<void> {
    try {
      const due = await this.ticketRepository
        .createQueryBuilder('ticket')
        .select(['ticket.id', 'ticket.aiResult'])
        .where("json_extract(ticket.aiResult, '$.source') = 'failed'")
        .andWhere("json_extract(ticket.aiResult, '$.retryAt') <= :now", { now: now.toISOString() })
        .getMany();

      for (const ticket of due) {
        const failure = ticket.aiResult as TicketAiFailure;
        const pending: TicketAiPending = { source: 'pending', requestedAt: now.toISOString(), autoRetries: (failure.autoRetries ?? 0) + 1 };
        // Only if it is still the same failure: Helpdesk may have pressed "Retry" in the meantime.
        const claimed = await this.ticketRepository
          .createQueryBuilder()
          .update(TicketEntity)
          .set({ aiResult: pending })
          .where('id = :id', { id: ticket.id })
          .andWhere("json_extract(aiResult, '$.retryAt') = :retryAt", { retryAt: failure.retryAt })
          .execute();
        if (claimed.affected) void this.enqueue(ticket.id);
      }
    } catch (error) {
      this.logger.error(`Could not schedule automatic AI retries: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async process(ticketId: string): Promise<void> {
    try {
      const ticket = await this.ticketRepository.findOneBy({ id: ticketId });
      const pending = ticket?.aiResult;
      if (!ticket || pending?.source !== 'pending') return;

      const requester = await this.userRepository.findOneBy({ id: ticket.requesterId });
      const result = await this.rqstyAiService.analyzeTicket({
        requesterName: requester ? `${requester.firstName} ${requester.lastName}`.trim() : ticket.requesterId,
        jobTitle: requester?.jobTitle ?? 'Employee',
        title: ticket.title,
        description: ticket.description,
        team: TEAM_NAMES[ticket.teamId] ?? ticket.teamId,
        issueType: ticket.issueType,
        project: ticket.project,
      });

      const autoRetries = pending.autoRetries ?? 0;
      const retryDelay = result.source === 'failed' && result.temporary ? AUTO_RETRY_DELAYS_MS[autoRetries] : undefined;
      const stored =
        result.source === 'failed'
          ? { ...result, autoRetries, ...(retryDelay ? { retryAt: new Date(Date.now() + retryDelay).toISOString() } : {}) }
          : result;

      // Only the analysis column is written, so a workflow change made meanwhile is never overwritten.
      await this.ticketRepository.update({ id: ticketId }, { aiResult: stored });
      await this.auditService.record({
        category: 'ticket',
        action: stored.source === 'ai' ? 'AI_ANALYSIS_COMPLETED' : 'AI_ANALYSIS_FAILED',
        outcome: stored.source === 'ai' ? 'success' : 'failure',
        target: { type: 'ticket', id: ticketId },
        summary:
          stored.source === 'ai'
            ? `AI analysed "${ticket.title}"${stored.isUnclear ? ' (flagged as unclear)' : ''}`
            : `AI analysis failed for "${ticket.title}": ${stored.failureReason}${stored.retryAt ? ' An automatic retry is scheduled.' : ''}`,
        details:
          stored.source === 'failed'
            ? { failureCode: stored.failureCode, attempts: stored.attempts, autoRetries, retryAt: stored.retryAt ?? null }
            : { attempts: stored.attempts ?? 1, autoRetries },
      });
    } catch (error) {
      this.logger.error(`AI analysis for ticket ${ticketId} could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.queued.delete(ticketId);
    }
  }
}
