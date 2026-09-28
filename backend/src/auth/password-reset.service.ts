import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { invitationEmail, passwordResetEmail } from '../mail/mail-templates';
import { MailService } from '../mail/mail.service';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { hashPassword } from './password';
import { passwordProblem } from './password-policy';
import { PasswordResetTokenEntity } from './password-reset-token.entity';
import { UserEntity } from './user.entity';

const RESET_MINUTES = 15;
const INVITE_LINK_HOURS = 72;
const MAX_REQUESTS_PER_HOUR = 3;
const MAX_CODE_ATTEMPTS = 5;
const INVALID_LINK = 'This link is invalid or has expired. Request a new one.';
// Deliberately the same for a wrong code, an expired one, and an unknown email.
const INVALID_CODE = 'That code is incorrect or has expired. Check the latest email or request a new code.';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

// Either the secret from the emailed link, or the account email plus the 6-digit code.
export type ResetCredential = { token: string } | { email: string; code: string };

@Injectable()
export class PasswordResetService {
  private readonly appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

  constructor(
    @InjectRepository(PasswordResetTokenEntity) private readonly tokenRepository: Repository<PasswordResetTokenEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
  ) {}

  // "Forgot password". The caller always gets the same answer, so it cannot be used to find out who has an account.
  async requestReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userRepository.findOneBy({ email: normalizedEmail });

    if (!user || user.status !== 'active') {
      await this.auditService.record({
        category: 'auth',
        action: 'PASSWORD_RESET_REQUESTED',
        outcome: 'failure',
        summary: `Password reset requested for ${normalizedEmail} (${user ? 'account disabled' : 'unknown email'}); no email sent`,
        details: { email: normalizedEmail, reason: user ? 'account disabled' : 'unknown email' },
      });
      return;
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await this.tokenRepository.count({ where: { userId: user.id, createdAt: MoreThan(oneHourAgo) } });
    if (recent >= MAX_REQUESTS_PER_HOUR) {
      await this.auditService.record({
        category: 'auth',
        action: 'PASSWORD_RESET_REQUESTED',
        outcome: 'denied',
        target: { type: 'user', id: user.id },
        summary: `Password reset for ${normalizedEmail} refused (more than ${MAX_REQUESTS_PER_HOUR} requests in an hour)`,
        details: { email: normalizedEmail, reason: 'rate limited' },
      });
      return;
    }

    await this.issue(user, 'reset', null);
  }

  // Creates a new link (and code, for resets), cancelling earlier unused ones, and emails it.
  async issue(user: UserEntity, purpose: 'reset' | 'invite', requestedBy: AuthenticatedUser | null): Promise<void> {
    const now = new Date();
    await this.tokenRepository.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now.toISOString() });

    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const code = purpose === 'reset' ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;
    const lifetimeMs = purpose === 'invite' ? INVITE_LINK_HOURS * 60 * 60 * 1000 : RESET_MINUTES * 60 * 1000;
    await this.tokenRepository.insert({
      id,
      userId: user.id,
      tokenHash: sha256(secret),
      codeHash: code ? sha256(`${id}:${code}`) : null,
      failedAttempts: 0,
      purpose,
      requestedBy: requestedBy?.id ?? null,
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
      usedAt: null,
      createdAt: now.toISOString(),
    });

    const link = `${this.appUrl}/?reset=${secret}`;
    const rendered =
      purpose === 'invite'
        ? invitationEmail({ firstName: user.firstName, link, hours: INVITE_LINK_HOURS })
        : passwordResetEmail({ firstName: user.firstName, code: code!, link, minutes: RESET_MINUTES });
    await this.mailService.send({
      to: user.email,
      purpose: purpose === 'invite' ? 'account-invite' : 'password-reset',
      subject: rendered.subject,
      body: rendered.text,
      html: rendered.html,
    });

    await this.auditService.record({
      category: 'auth',
      action: purpose === 'invite' ? 'USER_INVITED' : 'PASSWORD_RESET_REQUESTED',
      actor: requestedBy,
      target: { type: 'user', id: user.id },
      summary:
        purpose === 'invite'
          ? `Invitation email sent to ${user.email}`
          : `Password reset code and link sent to ${user.email}${requestedBy ? ' by an administrator' : ''}`,
      details: { email: user.email },
    });
  }

  // Lets the reset page say "this link has expired" before the user types a new password.
  async check(token: string): Promise<{ valid: boolean; purpose?: 'reset' | 'invite'; email?: string }> {
    const found = await this.findByToken(token);
    return found ? { valid: true, purpose: found.record.purpose, email: maskEmail(found.user.email) } : { valid: false };
  }

  // Step 2 of the code flow: confirms the code before asking for a new password. Wrong codes count as attempts.
  async verifyCode(email: string, code: string): Promise<{ valid: true }> {
    await this.findByCode(email, code);
    return { valid: true };
  }

  async reset(credential: ResetCredential, newPassword: string): Promise<void> {
    const found = 'token' in credential ? await this.findByToken(credential.token) : await this.findByCode(credential.email, credential.code);
    if (!found) {
      await this.auditService.record({
        category: 'auth',
        action: 'PASSWORD_RESET_FAILED',
        outcome: 'failure',
        summary: 'Password reset attempted with an invalid or expired link',
        details: { reason: 'invalid or expired link' },
      });
      throw new BadRequestException(INVALID_LINK);
    }

    const weakness = passwordProblem(newPassword);
    if (weakness) throw new BadRequestException(weakness);

    const now = new Date().toISOString();
    // Marking it used first means a second request with the same link or code cannot also succeed.
    const claimed = await this.tokenRepository.update({ id: found.record.id, usedAt: IsNull() }, { usedAt: now });
    if (!claimed.affected) throw new BadRequestException('token' in credential ? INVALID_LINK : INVALID_CODE);

    await this.userRepository.update({ id: found.user.id }, { password: hashPassword(newPassword), passwordChangedAt: now, sessionsRevokedAt: now });
    await this.auditService.record({
      category: 'auth',
      action: found.record.purpose === 'invite' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET_COMPLETED',
      actor: { id: found.user.id, role: found.user.role },
      target: { type: 'user', id: found.user.id },
      summary: `${found.user.firstName} ${found.user.lastName} ${
        found.record.purpose === 'invite' ? 'set their password from the invitation' : `reset their password with the emailed ${'token' in credential ? 'link' : 'code'}`
      }; other sessions were signed out`,
    });
  }

  private async findByToken(token: string): Promise<{ record: PasswordResetTokenEntity; user: UserEntity } | null> {
    if (!token || token.length > 200) return null;
    const record = await this.tokenRepository.findOneBy({ tokenHash: sha256(token) });
    return this.usable(record);
  }

  // Checks the code against the account's latest reset email. Throws the same message for every failure.
  private async findByCode(email: string, code: string): Promise<{ record: PasswordResetTokenEntity; user: UserEntity }> {
    const cleanCode = code.replace(/\s/g, '');
    const user = await this.userRepository.findOneBy({ email: email.trim().toLowerCase() });
    const record = user
      ? await this.tokenRepository.findOne({ where: { userId: user.id, purpose: 'reset', usedAt: IsNull() }, order: { createdAt: 'DESC' } })
      : null;
    const found = await this.usable(record);

    if (!found || !found.record.codeHash || found.record.failedAttempts >= MAX_CODE_ATTEMPTS || !/^\d{6}$/.test(cleanCode)) {
      throw new BadRequestException(INVALID_CODE);
    }

    const expected = Buffer.from(found.record.codeHash, 'hex');
    const actual = Buffer.from(sha256(`${found.record.id}:${cleanCode}`), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      const attempts = found.record.failedAttempts + 1;
      // After too many wrong codes the reset is cancelled; the user must request a new email.
      await this.tokenRepository.update(
        { id: found.record.id },
        attempts >= MAX_CODE_ATTEMPTS ? { failedAttempts: attempts, usedAt: new Date().toISOString() } : { failedAttempts: attempts },
      );
      await this.auditService.record({
        category: 'auth',
        action: 'PASSWORD_RESET_FAILED',
        outcome: 'failure',
        target: { type: 'user', id: found.user.id },
        summary: `Wrong password reset code entered for ${found.user.email} (attempt ${attempts} of ${MAX_CODE_ATTEMPTS})${attempts >= MAX_CODE_ATTEMPTS ? '; reset cancelled' : ''}`,
        details: { reason: 'wrong code', attempts },
      });
      throw new BadRequestException(INVALID_CODE);
    }
    return found;
  }

  private async usable(record: PasswordResetTokenEntity | null): Promise<{ record: PasswordResetTokenEntity; user: UserEntity } | null> {
    if (!record || record.usedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
    const user = await this.userRepository.findOneBy({ id: record.userId });
    if (!user || user.status !== 'active') return null;
    return { record, user };
  }
}
