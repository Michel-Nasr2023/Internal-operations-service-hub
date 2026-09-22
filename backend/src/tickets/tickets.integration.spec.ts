import { DataSource } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketsService } from './tickets.service';
import { TicketStatus } from './ticket.types';
import { RqstyAiService } from '../ai/rqsty-ai.service';

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
    const rqstyAiService = {
      generateStructuredResult: async (input: { employeeId: string; jobTitle: string; productName: string; freeText: string }) => ({
        employeeId: input.employeeId,
        jobTitle: input.jobTitle,
        freeText: input.freeText,
        productName: input.productName,
        issueType: 'access' as const,
        severity: 'high' as const,
        recommendedAction: 'Verify account permissions and re-test access.',
      }),
    } as unknown as RqstyAiService;
    const service = new TicketsService(dataSource.getRepository(TicketEntity), rqstyAiService);
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
