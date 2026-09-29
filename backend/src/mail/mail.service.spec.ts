import { DataSource } from 'typeorm';
import { MailService } from './mail.service';
import { OutboxEmailEntity } from './outbox-email.entity';

// Stands in for the SMTP connection: fails with the queued errors first, then accepts.
class FakeTransport {
  readonly sent: Array<{ to: string; html?: string }> = [];
  constructor(private readonly failures: unknown[] = []) {}
  async sendMail(message: { to: string; html?: string }): Promise<object> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(message);
    return {};
  }
}

const mailError = (code: string, message: string) => Object.assign(new Error(message), { code });
const email = { to: 'maya@company.com', subject: 'Reset your password', body: 'Code 123456', html: '<p>Code 123456</p>', purpose: 'password-reset' };
const later = (ms: number) => new Date(Date.now() + ms);

describe('MailService delivery retries', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await new DataSource({ type: 'sqlite', database: ':memory:', entities: [OutboxEmailEntity], synchronize: true }).initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  function serviceWith(transport: FakeTransport): MailService {
    const service = new MailService(dataSource.getRepository(OutboxEmailEntity));
    // The real transport is only created from SMTP settings outside tests.
    (service as unknown as { transporter: FakeTransport }).transporter = transport;
    return service;
  }

  const row = async () => (await dataSource.getRepository(OutboxEmailEntity).find())[0];

  it('sends an email again after a temporary problem, with the same content', async () => {
    const transport = new FakeTransport([mailError('ETIMEDOUT', 'Connection timeout')]);
    const service = serviceWith(transport);

    await service.send(email);
    expect(await row()).toMatchObject({ status: 'retrying', attempts: 1, error: 'Connection timeout', nextAttemptAt: expect.any(String) });

    await service.retryDue();
    expect((await row()).status).toBe('retrying');

    await service.retryDue(later(61_000));
    expect(await row()).toMatchObject({ status: 'sent', attempts: 2, error: null, nextAttemptAt: null });
    expect(transport.sent).toEqual([expect.objectContaining({ to: 'maya@company.com', html: '<p>Code 123456</p>' })]);
  });

  it('gives up after 3 attempts, and never retries a refusal', async () => {
    const down = serviceWith(new FakeTransport([mailError('ECONNECTION', 'down'), mailError('ECONNECTION', 'down'), mailError('ECONNECTION', 'still down')]));
    await down.send(email);
    await down.retryDue(later(61_000));
    await down.retryDue(later(6 * 60_000));
    expect(await row()).toMatchObject({ status: 'failed', attempts: 3, error: 'still down', nextAttemptAt: null });

    await dataSource.getRepository(OutboxEmailEntity).clear();
    const wrongPassword = serviceWith(new FakeTransport([mailError('EAUTH', 'Invalid login')]));
    await wrongPassword.send(email);
    expect(await row()).toMatchObject({ status: 'failed', attempts: 1, nextAttemptAt: null });
  });
});
