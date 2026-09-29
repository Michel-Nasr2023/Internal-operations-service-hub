import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Public check for monitoring and for the web app's "connection lost" banner: is the API up, and can it use
// its database? Reveals nothing about users or tickets.
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok'; time: string }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'failed', message: 'The database cannot be reached.' });
    }
    return { status: 'ok', database: 'ok', time: new Date().toISOString() };
  }
}
