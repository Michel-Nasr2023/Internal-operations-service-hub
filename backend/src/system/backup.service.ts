import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DataSource } from 'typeorm';
import { BACKUP_DIR } from '../common/env';
import { describeError } from '../common/log-safe';

const KEEP_DAYS = 7;
const BACKUP_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const BACKUP_FILE = /^tickets-.+\.sqlite$/;

// Plan B for the data: a copy of the database at start-up and every 6 hours. There is one file per day (a
// later copy on the same day replaces it), and the last 7 days are kept, so frequent restarts cannot push
// the older days out. To restore, stop the server and copy a backup over data/tickets.sqlite.
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  // Never throws: a failed backup is logged and tried again later, and the hub keeps running.
  async backUp(directory = BACKUP_DIR): Promise<string | null> {
    try {
      await mkdir(directory, { recursive: true });
      const file = join(directory, `tickets-${new Date().toISOString().slice(0, 10)}.sqlite`);
      // VACUUM INTO writes a consistent copy of the live database, even while the hub is using it. It is
      // written under a temporary name first, so a failed copy never replaces a good one.
      const partial = `${file}.partial`;
      await rm(partial, { force: true });
      await this.dataSource.query('VACUUM INTO ?', [partial]);
      await rename(partial, file);
      await this.prune(directory);
      this.logger.log(`Database backed up (${basename(file)})`);
      return file;
    } catch (error) {
      this.logger.error(`Database backup failed: ${describeError(error)}`);
      return null;
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(async () => {
      const file = await this.backUp();
      this.schedule(file ? BACKUP_EVERY_MS : RETRY_AFTER_FAILURE_MS);
    }, delayMs);
    this.timer.unref();
  }

  // File names sort by date, so everything before the newest 7 is removed.
  private async prune(directory: string): Promise<void> {
    const backups = (await readdir(directory)).filter((name) => BACKUP_FILE.test(name)).sort();
    for (const name of backups.slice(0, -KEEP_DAYS)) await rm(join(directory, name), { force: true });
  }
}
