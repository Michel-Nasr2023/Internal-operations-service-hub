import 'dotenv/config';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { createTransport, Transporter } from 'nodemailer';
import { Repository } from 'typeorm';
import { OutboxEmailEntity } from './outbox-email.entity';

export interface OutgoingEmail {
  to: string;
  subject: string;
  // Plain-text version (always stored); `html` is the rich version sent to the recipient.
  body: string;
  html?: string;
  purpose: string;
}

export interface MailStatus {
  mode: 'smtp' | 'outbox-only';
  host?: string;
  from?: string;
  // Result of checking the connection and login at start-up.
  connection: 'ok' | 'failed' | 'unchecked' | 'not-configured';
  connectionError?: string;
  lastSentAt?: string | null;
  lastFailure?: { at: string; error: string } | null;
}

// Single place where email leaves the system. With SMTP settings in the environment it sends real email
// (Gmail, Outlook / Microsoft 365, or any mail server); without them, emails are only recorded in the outbox
// and printed in the server console. Every email and its delivery result is kept in the outbox.
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly host = process.env.SMTP_HOST;
  private readonly from = process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'no-reply@localhost';
  private readonly transporter: Transporter | null;
  private connection: MailStatus['connection'] = 'not-configured';
  private connectionError?: string;

  constructor(@InjectRepository(OutboxEmailEntity) private readonly outboxRepository: Repository<OutboxEmailEntity>) {
    if (this.host && process.env.NODE_ENV !== 'test') {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = createTransport({
        host: this.host,
        port,
        // Port 465 uses TLS from the start; 587 upgrades with STARTTLS.
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
      });
      this.connection = 'unchecked';
    } else {
      this.transporter = null;
    }
  }

  // Checks the mail server login once at start-up so a wrong password shows up in Admin > System straight away.
  async onModuleInit(): Promise<void> {
    if (!this.transporter) {
      if (process.env.NODE_ENV !== 'test') {
        this.logger.warn('SMTP_HOST is not set: emails are recorded in the outbox (Admin > System) and printed here, but not sent.');
      }
      return;
    }
    try {
      await this.transporter.verify();
      this.connection = 'ok';
      this.logger.log(`Mail server ${this.host} is ready; sending as ${this.from}.`);
    } catch (error) {
      this.connection = 'failed';
      this.connectionError = error instanceof Error ? error.message : String(error);
      this.logger.error(`Mail server ${this.host} could not be used: ${this.connectionError}`);
    }
  }

  // Never throws: a delivery problem is recorded on the outbox row, so the caller's action still succeeds.
  async send(email: OutgoingEmail): Promise<void> {
    const id = randomUUID();
    await this.outboxRepository.insert({
      id,
      to: email.to,
      subject: email.subject,
      body: email.body,
      purpose: email.purpose,
      status: 'not-configured',
      createdAt: new Date().toISOString(),
    });

    if (!this.transporter) {
      if (process.env.NODE_ENV !== 'test') this.logger.log(`Email to ${email.to} (not sent, no mail server) — ${email.subject}\n${email.body}`);
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to: email.to, subject: email.subject, text: email.body, html: email.html });
      await this.outboxRepository.update({ id }, { status: 'sent', sentAt: new Date().toISOString(), error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.outboxRepository.update({ id }, { status: 'failed', error: message.slice(0, 500) });
      this.logger.error(`Email to ${email.to} failed: ${message}`);
    }
  }

  async listOutbox(limit = 50): Promise<OutboxEmailEntity[]> {
    return this.outboxRepository.find({ order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 200) });
  }

  async status(): Promise<MailStatus> {
    const [lastSent, lastFailed] = await Promise.all([
      this.outboxRepository.findOne({ where: { status: 'sent' }, order: { createdAt: 'DESC' } }),
      this.outboxRepository.findOne({ where: { status: 'failed' }, order: { createdAt: 'DESC' } }),
    ]);
    return {
      mode: this.transporter ? 'smtp' : 'outbox-only',
      host: this.host,
      from: this.transporter ? this.from : undefined,
      connection: this.connection,
      connectionError: this.connectionError,
      lastSentAt: lastSent?.sentAt ?? null,
      lastFailure: lastFailed ? { at: lastFailed.createdAt, error: lastFailed.error ?? 'Unknown error' } : null,
    };
  }
}
