import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { RqstyAiService } from '../ai/rqsty-ai.service';
import { UserEntity } from '../auth/user.entity';
import { MailService } from '../mail/mail.service';
import { BackupService } from './backup.service';
import { HealthController } from './health.controller';

describe('Database backups and health check', () => {
  let dataSource: DataSource;
  const backupDir = mkdtempSync(join(tmpdir(), 'hub-backups-'));

  beforeEach(async () => {
    dataSource = await new DataSource({ type: 'sqlite', database: ':memory:', entities: [UserEntity], synchronize: true }).initialize();
    await dataSource.getRepository(UserEntity).insert({
      id: 'employee-1', email: 'maya@company.com', password: 'unused', role: 'employee', firstName: 'Maya', lastName: 'Stone', status: 'active', createdAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  afterAll(() => rmSync(backupDir, { recursive: true, force: true }));

  it('keeps one readable copy per day, for the last 7 days', async () => {
    // Nine older days already backed up.
    for (let day = 1; day <= 9; day += 1) writeFileSync(join(backupDir, `tickets-2026-01-0${day}.sqlite`), 'older copy');
    const service = new BackupService(dataSource);

    const today = await service.backUp(backupDir);
    // A second copy on the same day replaces that day's file instead of pushing another day out.
    expect(await service.backUp(backupDir)).toBe(today);

    const kept = readdirSync(backupDir).filter((name) => name.endsWith('.sqlite')).sort();
    expect(kept).toHaveLength(7);
    expect(kept[0]).toBe('tickets-2026-01-04.sqlite');
    expect(kept.at(-1)).toBe(`tickets-${new Date().toISOString().slice(0, 10)}.sqlite`);

    const copy = await new DataSource({ type: 'sqlite', database: today!, entities: [UserEntity] }).initialize();
    expect(await copy.getRepository(UserEntity).findOneBy({ id: 'employee-1' })).toMatchObject({ email: 'maya@company.com' });
    await copy.destroy();
  });

  it('reports a failed backup instead of throwing', async () => {
    await dataSource.destroy();
    await expect(new BackupService(dataSource).backUp(backupDir)).resolves.toBeNull();
  });

  it('answers the health check with state and small capability status only', async () => {
    const ai = { capability: () => 'paused' } as unknown as RqstyAiService;
    const mail = { capability: () => 'failed' } as unknown as MailService;
    const health = new HealthController(dataSource, ai, mail);

    const report = await health.check();
    expect(Object.keys(report).sort()).toEqual(['ai', 'database', 'email', 'status', 'time']);
    expect(report).toMatchObject({ status: 'ok', database: 'ok', ai: 'paused', email: 'failed' });
    // Nothing that looks like a secret, a web address, a file path or an email address.
    expect(JSON.stringify(report)).not.toMatch(/https?:|[\\/]|@|key|secret|password/i);

    await dataSource.destroy();
    const failure = await health.check().catch((error: ServiceUnavailableException) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect((failure as ServiceUnavailableException).getResponse()).toEqual({ status: 'unavailable', database: 'failed', message: 'The database cannot be reached.' });
  });
});
