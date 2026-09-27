import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { passwordProblem } from '../auth/password-policy';
import { hashPassword, verifyPassword } from '../auth/password';
import { signToken } from '../auth/token';
import { UserEntity } from '../auth/user.entity';
import { checkAttachment } from '../tickets/attachment-rules';
import { AuthenticatedUser, UserRole } from '../tickets/ticket.types';
import { ChangePasswordDto, UpdateProfileDto } from './profile.dto';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

export interface ProfileView {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  employeeId?: string;
  avatarUpdatedAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
}

export interface UploadedAvatar {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ProfileService {
  private readonly avatarDir = resolve(process.env.AVATARS_DIR ?? join('data', 'avatars'));

  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    private readonly auditService: AuditService,
  ) {}

  async get(user: AuthenticatedUser): Promise<ProfileView> {
    return this.toView(await this.load(user.id));
  }

  async update(user: AuthenticatedUser, dto: UpdateProfileDto): Promise<ProfileView> {
    const record = await this.load(user.id);
    const jobTitle = dto.jobTitle ? dto.jobTitle : undefined;
    const changed = [
      record.firstName !== dto.firstName && 'first name',
      record.lastName !== dto.lastName && 'last name',
      (record.jobTitle ?? undefined) !== jobTitle && 'job title',
    ].filter((field): field is string => !!field);

    if (changed.length > 0) {
      // null (not undefined) so clearing the job title is actually written.
      await this.userRepository.update({ id: record.id }, { firstName: dto.firstName, lastName: dto.lastName, jobTitle: (jobTitle ?? null) as string | undefined });
      await this.auditService.record({
        category: 'auth',
        action: 'PROFILE_UPDATED',
        actor: user,
        target: { type: 'user', id: record.id },
        summary: `${dto.firstName} ${dto.lastName} updated their ${changed.join(', ')}`,
        details: { fields: changed.join(', ') },
      });
    }
    return this.get(user);
  }

  // Requires the current password; failed attempts are audited.
  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto): Promise<{ passwordChangedAt: string; token: string }> {
    const record = await this.load(user.id);
    const fail = async (reason: string, message: string): Promise<never> => {
      await this.auditService.record({
        category: 'auth',
        action: 'PASSWORD_CHANGE_FAILED',
        outcome: 'failure',
        actor: user,
        target: { type: 'user', id: record.id },
        summary: `Password change refused for ${record.email} (${reason})`,
        details: { reason },
      });
      throw new BadRequestException(message);
    };

    if (!verifyPassword(dto.currentPassword, record.password)) await fail('wrong current password', 'Your current password is incorrect.');
    const weakness = passwordProblem(dto.newPassword);
    if (weakness) await fail('new password too weak', weakness);
    if (dto.newPassword === dto.currentPassword) await fail('same as current password', 'Choose a password that is different from your current one.');

    const passwordChangedAt = new Date().toISOString();
    // Every other session is signed out; the caller gets a new token issued after that moment.
    await this.userRepository.update({ id: record.id }, { password: hashPassword(dto.newPassword), passwordChangedAt, sessionsRevokedAt: passwordChangedAt });
    await this.auditService.record({
      category: 'auth',
      action: 'PASSWORD_CHANGED',
      actor: user,
      target: { type: 'user', id: record.id },
      summary: `${record.firstName} ${record.lastName} changed their password; other sessions were signed out`,
    });
    return { passwordChangedAt, token: signToken({ id: record.id, role: record.role }) };
  }

  async setAvatar(user: AuthenticatedUser, file: UploadedAvatar | undefined): Promise<ProfileView> {
    if (!file) throw new BadRequestException('Choose an image to upload.');
    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!AVATAR_EXTENSIONS.includes(extension)) throw new BadRequestException('Profile photos must be PNG, JPG or WebP images.');
    const checked = checkAttachment(file.originalname, file.buffer);
    if ('error' in checked) throw new BadRequestException(checked.error);

    const record = await this.load(user.id);
    const avatarKey = `${record.id.replace(/[^A-Za-z0-9_-]/g, '_')}-${randomUUID()}`;
    await mkdir(this.avatarDir, { recursive: true });
    await writeFile(join(this.avatarDir, avatarKey), file.buffer);

    const avatarUpdatedAt = new Date().toISOString();
    await this.userRepository.update({ id: record.id }, { avatarKey, avatarUpdatedAt });
    if (record.avatarKey) await rm(join(this.avatarDir, record.avatarKey), { force: true });

    await this.auditService.record({
      category: 'auth',
      action: 'AVATAR_UPDATED',
      actor: user,
      target: { type: 'user', id: record.id },
      summary: `${record.firstName} ${record.lastName} changed their profile photo`,
    });
    return this.get(user);
  }

  async removeAvatar(user: AuthenticatedUser): Promise<ProfileView> {
    const record = await this.load(user.id);
    if (record.avatarKey) {
      await this.userRepository.update({ id: record.id }, { avatarKey: null, avatarUpdatedAt: null });
      await rm(join(this.avatarDir, record.avatarKey), { force: true });
      await this.auditService.record({
        category: 'auth',
        action: 'AVATAR_REMOVED',
        actor: user,
        target: { type: 'user', id: record.id },
        summary: `${record.firstName} ${record.lastName} removed their profile photo`,
      });
    }
    return this.get(user);
  }

  // Any signed-in colleague may see a profile photo.
  async openAvatar(userId: string): Promise<{ stream: ReadStream; mimeType: string; size: number }> {
    const record = await this.userRepository.findOneBy({ id: userId });
    if (!record?.avatarKey) throw new NotFoundException('This user has no profile photo');

    const path = join(this.avatarDir, record.avatarKey);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new NotFoundException('The profile photo is missing from storage');
    }
    const header = await new Promise<Buffer>((resolveHeader, reject) => {
      const chunks: Buffer[] = [];
      createReadStream(path, { start: 0, end: 15 })
        .on('data', (chunk) => chunks.push(chunk as Buffer))
        .on('end', () => resolveHeader(Buffer.concat(chunks)))
        .on('error', reject);
    });
    const mimeType = header[0] === 0x89 ? 'image/png' : header.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : 'image/jpeg';
    return { stream: createReadStream(path), mimeType, size };
  }

  private async load(userId: string): Promise<UserEntity> {
    const record = await this.userRepository.findOneBy({ id: userId });
    if (!record) throw new NotFoundException('Your account could not be found');
    return record;
  }

  private toView(record: UserEntity): ProfileView {
    return {
      id: record.id,
      email: record.email,
      role: record.role,
      firstName: record.firstName,
      lastName: record.lastName,
      jobTitle: record.jobTitle ?? undefined,
      employeeId: record.employeeId,
      avatarUpdatedAt: record.avatarUpdatedAt ?? null,
      passwordChangedAt: record.passwordChangedAt ?? null,
      createdAt: record.createdAt,
    };
  }
}
