import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RqstyAiService } from '../ai/rqsty-ai.service';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/user.entity';
import { TicketEntity } from './ticket.entity';

const TEAM_NAMES: Record<string, string> = {
  it: 'IT Operations',
  facilities: 'Facilities',
  finance: 'Finance',
};

// Runs AI ticket analysis in the background, one ticket at a time. Submission never waits for the AI, and
// running one request at a time keeps us under the provider's concurrent-request limit.
@Injectable()
export class TicketAnalysisQueue implements OnModuleInit {
  private readonly logger = new Logger(TicketAnalysisQueue.name);
  private chain: Promise<void> = Promise.resolve();
  private readonly queued = new Set<string>();

  constructor(
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    private readonly rqstyAiService: RqstyAiService,
    private readonly auditService: AuditService,
  ) {}

  // Tickets left "pending" by a restart are picked up again.
  async onModuleInit(): Promise<void> {
    try {
      const tickets = await this.ticketRepository.find();
      for (const ticket of tickets) {
        if (ticket.aiResult?.source === 'pending') void this.enqueue(ticket.id);
      }
    } catch (error) {
      this.logger.error(`Could not resume pending AI analyses: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  private async process(ticketId: string): Promise<void> {
    try {
      const ticket = await this.ticketRepository.findOneBy({ id: ticketId });
      if (!ticket || ticket.aiResult?.source !== 'pending') return;

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

      // Only the analysis column is written, so a workflow change made meanwhile is never overwritten.
      await this.ticketRepository.update({ id: ticketId }, { aiResult: result });
      await this.auditService.record({
        category: 'ticket',
        action: result.source === 'ai' ? 'AI_ANALYSIS_COMPLETED' : 'AI_ANALYSIS_FAILED',
        outcome: result.source === 'ai' ? 'success' : 'failure',
        target: { type: 'ticket', id: ticketId },
        summary:
          result.source === 'ai'
            ? `AI analysed "${ticket.title}"${result.isUnclear ? ' (flagged as unclear)' : ''}`
            : `AI analysis failed for "${ticket.title}": ${result.source === 'failed' ? result.failureReason : ''}`,
        details: result.source === 'failed' ? { failureCode: result.failureCode, attempts: result.attempts } : { attempts: result.attempts ?? 1 },
      });
    } catch (error) {
      this.logger.error(`AI analysis for ticket ${ticketId} could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.queued.delete(ticketId);
    }
  }
}
