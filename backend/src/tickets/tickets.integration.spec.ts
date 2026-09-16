import { DataSource } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketsService } from './tickets.service';
import { TicketStatus } from './ticket.types';

describe('TicketsService SQLite integration', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [TicketEntity],
      synchronize: true,
    }).initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('persists a created ticket and its audit event in SQLite', async () => {
    const service = new TicketsService(dataSource.getRepository(TicketEntity));
    const employee = { id: 'employee-1', role: 'employee' as const };

    const created = await service.create(
      {
        title: 'VPN access issue',
        description: 'The internal VPN rejects my credentials.',
        teamId: 'it',
        issueType: 'access',
        project: 'internal',
      },
      employee,
    );

    const persisted = await dataSource.getRepository(TicketEntity).findOneBy({ id: created.id });

    expect(persisted).toMatchObject({
      id: created.id,
      requesterId: 'employee-1',
      status: TicketStatus.PENDING_HELPDESK_REVIEW,
      title: 'VPN access issue',
    });
    expect(persisted?.auditEvents).toHaveLength(1);
    expect(persisted?.auditEvents[0].action).toBe('TICKET_SUBMITTED');
  });
});
