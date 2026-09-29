import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
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

  it('answers the health check, and reports when the database is unreachable', async () => {
    const health = new HealthController(dataSource);
    await expect(health.check()).resolves.toMatchObject({ status: 'ok', database: 'ok' });

    await dataSource.destroy();
    await expect(health.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
