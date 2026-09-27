import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { OutboxEmailEntity } from './outbox-email.entity';

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
  purpose: string;
}

// Single place where email leaves the system. It currently records each email in the outbox and prints it to
// the server console; connecting a real provider (SMTP or an email API) only means changing `deliver`.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectRepository(OutboxEmailEntity) private readonly outboxRepository: Repository<OutboxEmailEntity>) {}

  async send(email: OutgoingEmail): Promise<void> {
    await this.outboxRepository.insert({ id: randomUUID(), ...email, createdAt: new Date().toISOString() });
    await this.deliver(email);
  }

  async listOutbox(limit = 50): Promise<OutboxEmailEntity[]> {
    return this.outboxRepository.find({ order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 200) });
  }

  private async deliver(email: OutgoingEmail): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    this.logger.log(`Email to ${email.to} — ${email.subject}\n${email.body}`);
  }
}
