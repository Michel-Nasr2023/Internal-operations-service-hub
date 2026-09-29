import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { TicketEntity } from '../tickets/ticket.entity';
import { Ticket, TicketStatus } from '../tickets/ticket.types';
import { NotificationEntity, NotificationKind } from './notification.entity';
import { describeError } from '../common/log-safe';

export const UNCLAIMED_ALERT_HOURS = 24;
const CHECK_INTERVAL_MS = Number(process.env.NOTIFICATION_CHECK_INTERVAL_MS ?? 5 * 60 * 1000);
const LIST_LIMIT = 50;

interface NotificationDraft {
  kind: NotificationKind;
  ticket: Pick<Ticket, 'id' | 'title'>;
  message: string;
  // Defaults to one alert per kind per ticket.
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(NotificationEntity) private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
  ) {}

  onModuleInit(): void {
    if (CHECK_INTERVAL_MS <= 0) return;
    this.timer = setInterval(() => void this.runScheduledChecks(), CHECK_INTERVAL_MS);
    this.timer.unref();
    // Catch up on anything that became due while the API was stopped.
    void this.runScheduledChecks();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async listForUser(userId: string): Promise<NotificationEntity[]> {
    return this.notificationRepository.find({
      where: { recipientId: userId },
      order: { createdAt: 'DESC' },
      take: LIST_LIMIT,
    });
  }

  async markRead(id: string, userId: string): Promise<NotificationEntity> {
    const notification = await this.notificationRepository.findOneBy({ id, recipientId: userId });
    if (!notification) throw new NotFoundException('Notification not found');
    if (!notification.readAt) {
      notification.readAt = new Date().toISOString();
      await this.notificationRepository.update({ id: notification.id }, { readAt: notification.readAt });
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationRepository.update({ recipientId: userId, readAt: IsNull() }, { readAt: new Date().toISOString() });
  }

  async notifyHelpdesk(draft: NotificationDraft, exceptUserId?: string): Promise<void> {
    const helpdesk = await this.userRepository.find({ where: { role: In(['helpdesk', 'administrator']), status: 'active' } });
    await this.insert(helpdesk.map((user) => user.id).filter((id) => id !== exceptUserId), draft);
  }

  // `exceptUserId` is the person who caused the event; nobody is notified about their own action.
  async notifyUser(userId: string | undefined, draft: NotificationDraft, exceptUserId?: string): Promise<void> {
    if (userId && userId !== exceptUserId) await this.insert([userId], draft);
  }

  // Finds assignments left unclaimed for 24h and work past its due time, and alerts Helpdesk once per ticket.
  async runScheduledChecks(now = new Date()): Promise<void> {
    try {
      const unclaimedBefore = new Date(now.getTime() - UNCLAIMED_ALERT_HOURS * 60 * 60 * 1000).toISOString();
      const unclaimed = await this.ticketRepository.find({
        where: { status: TicketStatus.ASSIGNED, assignedAt: LessThanOrEqual(unclaimedBefore) },
      });
      for (const ticket of unclaimed) {
        await this.notifyHelpdesk({
          kind: 'ticket-unclaimed',
          ticket,
          message: `Assigned ${UNCLAIMED_ALERT_HOURS}+ hours ago and still not claimed.`,
          dedupeKey: `ticket-unclaimed:${ticket.id}:${ticket.assignedAt}`,
        });
      }

      const overdue = await this.ticketRepository.find({
        where: { status: TicketStatus.IN_PROGRESS, dueAt: LessThanOrEqual(now.toISOString()) },
      });
      for (const ticket of overdue) {
        await this.notifyHelpdesk({
          kind: 'ticket-overdue',
          ticket,
          message: `In progress past its expected completion time (${ticket.expectedDurationHours ?? '?'}h).`,
          dedupeKey: `ticket-overdue:${ticket.id}:${ticket.dueAt}`,
        });
      }
    } catch (error) {
      this.logger.error(`Scheduled notification check failed: ${describeError(error)}`);
    }
  }

  private async insert(recipientIds: string[], draft: NotificationDraft): Promise<void> {
    if (recipientIds.length === 0) return;
    const createdAt = new Date().toISOString();
    const dedupeKey = draft.dedupeKey ?? `${draft.kind}:${draft.ticket.id}`;

    await this.notificationRepository
      .createQueryBuilder()
      .insert()
      .into(NotificationEntity)
      .values(
        recipientIds.map((recipientId) => ({
          id: randomUUID(),
          recipientId,
          ticketId: draft.ticket.id,
          kind: draft.kind,
          title: draft.ticket.title,
          message: draft.message,
          dedupeKey,
          createdAt,
          readAt: null,
        })),
      )
      .orIgnore()
      .execute();
  }
}
