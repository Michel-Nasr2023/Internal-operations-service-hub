import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { hashPassword } from './password';
import { passwordProblem } from './password-policy';
import { PasswordResetTokenEntity } from './password-reset-token.entity';
import { UserEntity } from './user.entity';

const RESET_LINK_MINUTES = 30;
const INVITE_LINK_HOURS = 72;
const MAX_REQUESTS_PER_HOUR = 3;
const INVALID_LINK = 'This link is invalid or has expired. Request a new one.';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

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

  // Creates a new link (cancelling earlier unused ones) and emails it. Used for self-service, admin resets and invites.
  async issue(user: UserEntity, purpose: 'reset' | 'invite', requestedBy: AuthenticatedUser | null): Promise<void> {
    const now = new Date();
    await this.tokenRepository.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now.toISOString() });

    const secret = randomBytes(32).toString('base64url');
    const lifetimeMs = purpose === 'invite' ? INVITE_LINK_HOURS * 60 * 60 * 1000 : RESET_LINK_MINUTES * 60 * 1000;
    await this.tokenRepository.insert({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashToken(secret),
      purpose,
      requestedBy: requestedBy?.id ?? null,
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
      usedAt: null,
      createdAt: now.toISOString(),
    });

    const link = `${this.appUrl}/?reset=${secret}`;
    await this.mailService.send(
      purpose === 'invite'
        ? {
            to: user.email,
            purpose: 'account-invite',
            subject: 'Your Internal Operations Service Hub account',
            body: `Hello ${user.firstName},\n\nAn account has been created for you. Set your password within ${INVITE_LINK_HOURS} hours using this link:\n${link}\n\nIf you were not expecting this, you can ignore this email.`,
          }
        : {
            to: user.email,
            purpose: 'password-reset',
            subject: 'Reset your Internal Operations Service Hub password',
            body: `Hello ${user.firstName},\n\nUse this link to set a new password. It works once and expires in ${RESET_LINK_MINUTES} minutes:\n${link}\n\nIf you did not ask for this, you can ignore this email; your password will not change.`,
          },
    );

    await this.auditService.record({
      category: 'auth',
      action: purpose === 'invite' ? 'USER_INVITED' : 'PASSWORD_RESET_REQUESTED',
      actor: requestedBy,
      target: { type: 'user', id: user.id },
      summary:
        purpose === 'invite'
          ? `Invitation email sent to ${user.email}`
          : `Password reset link sent to ${user.email}${requestedBy ? ' by an administrator' : ''}`,
      details: { email: user.email },
    });
  }

  async check(token: string): Promise<{ valid: boolean; purpose?: 'reset' | 'invite'; email?: string }> {
    const found = await this.findUsable(token);
    return found ? { valid: true, purpose: found.record.purpose, email: maskEmail(found.user.email) } : { valid: false };
  }

  async reset(token: string, newPassword: string): Promise<void> {
    const found = await this.findUsable(token);
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
    // Marking the link used first means a second request with the same link cannot also succeed.
    const claimed = await this.tokenRepository.update({ id: found.record.id, usedAt: IsNull() }, { usedAt: now });
    if (!claimed.affected) throw new BadRequestException(INVALID_LINK);

    await this.userRepository.update(
      { id: found.user.id },
      { password: hashPassword(newPassword), passwordChangedAt: now, sessionsRevokedAt: now },
    );
    await this.auditService.record({
      category: 'auth',
      action: found.record.purpose === 'invite' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET_COMPLETED',
      actor: { id: found.user.id, role: found.user.role },
      target: { type: 'user', id: found.user.id },
      summary: `${found.user.firstName} ${found.user.lastName} ${found.record.purpose === 'invite' ? 'set their password from the invitation' : 'reset their password'}; other sessions were signed out`,
    });
  }

  private async findUsable(token: string): Promise<{ record: PasswordResetTokenEntity; user: UserEntity } | null> {
    if (!token || token.length > 200) return null;
    const record = await this.tokenRepository.findOneBy({ tokenHash: hashToken(token) });
    if (!record || record.usedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
    const user = await this.userRepository.findOneBy({ id: record.userId });
    if (!user || user.status !== 'active') return null;
    return { record, user };
  }
}
