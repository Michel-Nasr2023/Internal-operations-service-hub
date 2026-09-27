import { DataSource } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { TicketEntity } from '../tickets/ticket.entity';
import { Ticket, TicketStatus } from '../tickets/ticket.types';
import { NotificationEntity } from './notification.entity';
import { NotificationsService } from './notifications.service';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-25T12:00:00.000Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

describe('NotificationsService scheduled checks', () => {
  let dataSource: DataSource;
  let service: NotificationsService;

  async function saveTicket(overrides: Partial<Ticket>): Promise<void> {
    await dataSource.getRepository(TicketEntity).save({
      id: overrides.id ?? 'ticket',
      requesterId: 'employee-1',
      teamId: 'it',
      issueType: 'hardware',
      project: 'internal',
      title: `Ticket ${overrides.id}`,
      description: 'Description',
      status: TicketStatus.ASSIGNED,
      createdAt: hoursAgo(48),
      updatedAt: hoursAgo(48),
      version: 1,
      auditEvents: [],
      ...overrides,
    });
  }

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [NotificationEntity, TicketEntity, UserEntity],
      synchronize: true,
    }).initialize();

    await dataSource.getRepository(UserEntity).save(
      ['helpdesk-1', 'helpdesk-2'].map((id) => ({
        id,
        email: `${id}@company.com`,
        password: 'unused',
        role: 'helpdesk' as const,
        firstName: 'Help',
        lastName: id,
        status: 'active' as const,
        createdAt: hoursAgo(100),
      })),
    );

    service = new NotificationsService(
      dataSource.getRepository(NotificationEntity),
      dataSource.getRepository(TicketEntity),
      dataSource.getRepository(UserEntity),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('alerts every Helpdesk user once about tickets unclaimed for 24 hours', async () => {
    await saveTicket({ id: 'stale', assignedAt: hoursAgo(25) });
    await saveTicket({ id: 'fresh', assignedAt: hoursAgo(23) });

    await service.runScheduledChecks(NOW);
    await service.runScheduledChecks(NOW);

    for (const helpdeskId of ['helpdesk-1', 'helpdesk-2']) {
      const inbox = await service.listForUser(helpdeskId);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({ kind: 'ticket-unclaimed', ticketId: 'stale' });
    }
  });

  it('alerts Helpdesk once when in-progress work passes its due time', async () => {
    await saveTicket({ id: 'late', status: TicketStatus.IN_PROGRESS, claimedAt: hoursAgo(10), dueAt: hoursAgo(2), expectedDurationHours: 8 });
    await saveTicket({ id: 'on-time', status: TicketStatus.IN_PROGRESS, claimedAt: hoursAgo(1), dueAt: new Date(NOW.getTime() + 7 * HOUR).toISOString() });
    await saveTicket({ id: 'done', status: TicketStatus.RESOLVED, dueAt: hoursAgo(5) });

    await service.runScheduledChecks(NOW);
    await service.runScheduledChecks(NOW);

    const inbox = await service.listForUser('helpdesk-1');
    expect(inbox.map((notification) => [notification.kind, notification.ticketId])).toEqual([['ticket-overdue', 'late']]);
  });

  it('marks notifications as read only for their own recipient', async () => {
    await saveTicket({ id: 'stale', assignedAt: hoursAgo(30) });
    await service.runScheduledChecks(NOW);
    const [notification] = await service.listForUser('helpdesk-1');

    await expect(service.markRead(notification.id, 'helpdesk-2')).rejects.toThrow('Notification not found');
    await service.markRead(notification.id, 'helpdesk-1');
    await service.markAllRead('helpdesk-2');

    expect((await service.listForUser('helpdesk-1'))[0].readAt).toEqual(expect.any(String));
    expect((await service.listForUser('helpdesk-2'))[0].readAt).toEqual(expect.any(String));
  });
});
