import '../common/env';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { createTransport, Transporter } from 'nodemailer';
import { LessThanOrEqual, Repository } from 'typeorm';
import { OutboxEmailEntity } from './outbox-email.entity';

// Pause before attempt 2 and attempt 3 of an email that failed for a temporary reason.
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000];
const RETRY_CHECK_INTERVAL_MS = 60 * 1000;
// Connection problems that usually pass: unreachable, timed out, connection dropped.
const TEMPORARY_ERROR_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'ECONNREFUSED']);

// Temporary: a connection problem, or a 4xx SMTP reply ("try again later"). Not temporary: a wrong login
// (EAUTH), a refused address (EENVELOPE) or a 5xx reply, which retrying cannot fix.
function isTemporaryMailError(error: unknown): boolean {
  const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };
  return (!!code && TEMPORARY_ERROR_CODES.has(code)) || (typeof responseCode === 'number' && responseCode >= 400 && responseCode < 500);
}

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
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly host = process.env.SMTP_HOST;
  private readonly from = process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'no-reply@localhost';
  private readonly transporter: Transporter | null;
  private connection: MailStatus['connection'] = 'not-configured';
  private connectionError?: string;
  private timer?: NodeJS.Timeout;
  private retrying = false;

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
    this.timer = setInterval(() => void this.retryDue(), RETRY_CHECK_INTERVAL_MS);
    this.timer.unref();
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

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Never throws: a delivery problem is recorded on the outbox row, so the caller's action still succeeds.
  async send(email: OutgoingEmail): Promise<void> {
    const row = {
      id: randomUUID(),
      to: email.to,
      subject: email.subject,
      body: email.body,
      html: email.html ?? null,
      purpose: email.purpose,
      status: 'not-configured' as const,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    await this.outboxRepository.insert(row);

    if (!this.transporter) {
      if (process.env.NODE_ENV !== 'test') this.logger.log(`Email to ${email.to} (not sent, no mail server) — ${email.subject}\n${email.body}`);
      return;
    }
    await this.deliver(row);
  }

  // Plan B for email: emails that failed for a temporary reason are sent again when their retry is due.
  // Runs every minute; never throws, and never overlaps itself.
  async retryDue(now = new Date()): Promise<void> {
    if (!this.transporter || this.retrying) return;
    this.retrying = true;
    try {
      const due = await this.outboxRepository.find({
        where: { status: 'retrying', nextAttemptAt: LessThanOrEqual(now.toISOString()) },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      for (const row of due) await this.deliver(row);
    } catch (error) {
      this.logger.error(`Email retries could not run: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.retrying = false;
    }
  }

  // One delivery attempt. A temporary problem (mail server unreachable, timed out or busy) is retried after
  // 1 and then 5 minutes, well within a reset code's 15 minutes. A refusal (wrong password, bad address) or a
  // third failure stays "failed" with the reason.
  private async deliver(row: Pick<OutboxEmailEntity, 'id' | 'to' | 'subject' | 'body' | 'html' | 'attempts'>): Promise<void> {
    const attempts = row.attempts + 1;
    try {
      await this.transporter!.sendMail({ from: this.from, to: row.to, subject: row.subject, text: row.body, html: row.html ?? undefined });
      await this.outboxRepository.update({ id: row.id }, { status: 'sent', sentAt: new Date().toISOString(), error: null, attempts, nextAttemptAt: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delay = isTemporaryMailError(error) ? RETRY_DELAYS_MS[attempts - 1] : undefined;
      await this.outboxRepository.update(
        { id: row.id },
        { status: delay ? 'retrying' : 'failed', error: message.slice(0, 500), attempts, nextAttemptAt: delay ? new Date(Date.now() + delay).toISOString() : null },
      );
      this.logger.error(`Email to ${row.to} failed (attempt ${attempts}): ${message}${delay ? ` — trying again in ${delay / 60000} min` : ''}`);
    }
  }

  async listOutbox(limit = 50): Promise<Omit<OutboxEmailEntity, 'html'>[]> {
    return this.outboxRepository.find({
      select: { id: true, to: true, subject: true, body: true, purpose: true, status: true, error: true, attempts: true, nextAttemptAt: true, sentAt: true, createdAt: true },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
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
