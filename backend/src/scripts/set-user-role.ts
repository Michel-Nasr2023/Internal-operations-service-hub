// Usage (from the project root): npm run user:role -- jane.doe@company.com helpdesk
// Changes a user's role directly in the database, signs them out so the new role applies at their next
// sign-in, and records the change in the audit log. Administrators can do the same from the Admin > Users page.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { UserEntity } from '../auth/user.entity';
import { DATABASE_FILE } from '../common/env';

const ROLES = ['employee', 'helpdesk', 'administrator'] as const;

async function main(): Promise<void> {
  const [emailArg, role] = process.argv.slice(2);
  if (!emailArg || !role || !(ROLES as readonly string[]).includes(role)) {
    console.error(`Usage: npm run user:role -- <email> <${ROLES.join('|')}>`);
    process.exit(1);
  }

  // The server may be running and writing at the same moment: wait for the file instead of failing.
  const dataSource = await new DataSource({ type: 'sqlite', database: DATABASE_FILE, busyTimeout: 5000, entities: [UserEntity, AuditLogEntity] }).initialize();
  try {
    const users = dataSource.getRepository(UserEntity);
    const email = emailArg.trim().toLowerCase();
    const user = await users.findOneBy({ email });
    if (!user) {
      console.error(`No account found for ${email}.`);
      process.exitCode = 1;
      return;
    }
    if (user.role === role) {
      console.log(`${email} is already ${role}.`);
      return;
    }

    const now = new Date().toISOString();
    await users.update({ id: user.id }, { role: role as UserEntity['role'], sessionsRevokedAt: now });
    await dataSource.getRepository(AuditLogEntity).insert({
      id: randomUUID(),
      timestamp: now,
      category: 'auth',
      action: 'USER_ROLE_CHANGED',
      outcome: 'success',
      actorId: null,
      actorRole: null,
      targetType: 'user',
      targetId: user.id,
      summary: `Changed ${user.firstName} ${user.lastName}'s role from ${user.role} to ${role} (command line)`,
      details: { from: user.role, to: role, via: 'command line' },
    });
    console.log(`${email} is now ${role}. They have been signed out and will get the new role when they sign in again.`);
  } finally {
    await dataSource.destroy();
  }
}

void main();
