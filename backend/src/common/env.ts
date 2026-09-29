import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// The backend folder (the one with package.json), found from this file so it is the same whether the server
// runs from src or dist, and whichever folder it was started from.
export const BACKEND_ROOT = findBackendRoot(__dirname);

function findBackendRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) return process.cwd();
  }
}

// Loads backend/.env. Settings already present in the real environment take precedence.
config({ path: join(BACKEND_ROOT, '.env'), quiet: true });

// Everything the hub stores: database, attachments, profile photos and backups. DATA_DIR can move it, for
// example out of a folder that a sync client such as OneDrive keeps locking.
export const DATA_DIR = resolve(BACKEND_ROOT, process.env.DATA_DIR || 'data');
export const DATABASE_FILE = join(DATA_DIR, 'tickets.sqlite');
export const BACKUP_DIR = join(DATA_DIR, 'backups');
