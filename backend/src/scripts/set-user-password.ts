// Usage (from the project root): npm run user:password -- admin@company.com Admin12345
// Recovery tool for the server operator, e.g. when a public demo account's password was changed by a visitor.
// Sets a new password (same rules as sign-up), signs the person out everywhere, and records it in the audit log.
// Within the app, people reset their own password by email instead.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { hashPassword } from '../auth/password';
import { passwordProblem } from '../auth/password-policy';
import { UserEntity } from '../auth/user.entity';
import { DATABASE_FILE } from '../common/env';

async function main(): Promise<void> {
  const [emailArg, password] = process.argv.slice(2);
  if (!emailArg || !password) {
    console.error('Usage: npm run user:password -- <email> <new password>');
    process.exit(1);
  }
  const weakness = passwordProblem(password);
  if (weakness) {
    console.error(weakness);
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

    const now = new Date().toISOString();
    await users.update({ id: user.id }, { password: await hashPassword(password), passwordChangedAt: now, sessionsRevokedAt: now });
    await dataSource.getRepository(AuditLogEntity).insert({
      id: randomUUID(),
      timestamp: now,
      category: 'auth',
      action: 'PASSWORD_RESET_COMPLETED',
      outcome: 'success',
      actorId: null,
      actorRole: null,
      targetType: 'user',
      targetId: user.id,
      summary: `Password of user ${user.id} set from the command line; other sessions were signed out`,
      details: { via: 'command line' },
    });
    console.log(`The password of ${email} has been changed and all their sessions were signed out.`);
  } finally {
    await dataSource.destroy();
  }
}

void main();
