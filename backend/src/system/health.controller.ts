import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RqstyAiService } from '../ai/rqsty-ai.service';
import { MailService } from '../mail/mail.service';

export interface HealthReport {
  status: 'ok';
  database: 'ok';
  // Small capability status, one word each: ok / paused / not-configured, and ok / failed / unchecked / not-configured.
  ai: ReturnType<RqstyAiService['capability']>;
  email: ReturnType<MailService['capability']>;
  time: string;
}

// Public check for monitoring, the smoke test and the web app's "connection lost" banner. It answers "is it
// healthy?" and nothing more: no secrets, user or ticket data, raw errors, file paths or provider URLs.
// Detailed diagnostics are only in Admin > System, behind an administrator session.
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: RqstyAiService,
    private readonly mail: MailService,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'failed', message: 'The database cannot be reached.' });
    }
    return { status: 'ok', database: 'ok', ai: this.ai.capability(), email: this.mail.capability(), time: new Date().toISOString() };
  }
}
