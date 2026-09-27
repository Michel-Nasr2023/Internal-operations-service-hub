import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { In, Repository } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { checkAttachment, cleanFileName, MAX_FILES_PER_TICKET, MAX_FILES_PER_UPLOAD } from './attachment-rules';
import { AttachmentStage, TicketAttachmentEntity } from './ticket-attachment.entity';
import { TicketEntity } from './ticket.entity';
import { AuthenticatedUser, TicketStatus } from './ticket.types';
import { TicketsService } from './tickets.service';

// The subset of a Multer upload this service uses.
export interface UploadedFileData {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface AttachmentView {
  id: string;
  ticketId: string;
  stage: AttachmentStage;
  fileName: string;
  mimeType: string;
  size: number;
  uploaderId: string;
  uploaderName?: string;
  createdAt: string;
}

@Injectable()
export class TicketAttachmentsService {
  // Local-disk storage for this deployment; ADR-001 keeps file bytes out of the database.
  private readonly storageDir = resolve(process.env.ATTACHMENTS_DIR ?? join('data', 'attachments'));

  constructor(
    @InjectRepository(TicketAttachmentEntity) private readonly attachmentRepository: Repository<TicketAttachmentEntity>,
    @InjectRepository(TicketEntity) private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    private readonly ticketsService: TicketsService,
  ) {}

  async list(ticketId: string, user: AuthenticatedUser): Promise<AttachmentView[]> {
    await this.getReadableTicket(ticketId, user);
    const attachments = await this.attachmentRepository.find({ where: { ticketId }, order: { createdAt: 'ASC' } });
    return this.present(attachments);
  }

  // The requester attaches files to their open ticket; the assignee attaches files while working on it.
  async upload(ticketId: string, files: UploadedFileData[], user: AuthenticatedUser): Promise<AttachmentView[]> {
    const ticket = await this.getReadableTicket(ticketId, user);
    const stage = this.uploadStage(ticket, user);

    if (!files || files.length === 0) throw new BadRequestException('Choose at least one file to attach.');
    if (files.length > MAX_FILES_PER_UPLOAD) throw new BadRequestException(`You can attach up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
    const existing = await this.attachmentRepository.count({ where: { ticketId } });
    if (existing + files.length > MAX_FILES_PER_TICKET) {
      throw new BadRequestException(`A ticket can have at most ${MAX_FILES_PER_TICKET} attachments (it already has ${existing}).`);
    }

    // Check every file before storing any, so an upload is all-or-nothing.
    const checked = files.map((file) => {
      const fileName = cleanFileName(file.originalname);
      const result = checkAttachment(fileName, file.buffer);
      if ('error' in result) throw new BadRequestException(result.error);
      return { file, fileName, mimeType: result.mimeType };
    });

    await mkdir(this.storageDir, { recursive: true });
    const saved: TicketAttachmentEntity[] = [];
    try {
      for (const { file, fileName, mimeType } of checked) {
        const id = randomUUID();
        await writeFile(join(this.storageDir, id), file.buffer);
        const attachment = this.attachmentRepository.create({
          id,
          ticketId,
          uploaderId: user.id,
          stage,
          fileName,
          mimeType,
          size: file.size,
          storageKey: id,
          createdAt: new Date().toISOString(),
        });
        saved.push(await this.attachmentRepository.save(attachment));
      }
    } catch (error) {
      // Undo a partial upload: remove stored files and their metadata.
      await Promise.all(saved.map((attachment) => rm(join(this.storageDir, attachment.storageKey), { force: true })));
      if (saved.length > 0) await this.attachmentRepository.delete({ id: In(saved.map((attachment) => attachment.id)) });
      throw error;
    }

    await this.ticketsService.recordHistory(ticketId, user, 'ATTACHMENTS_ADDED', saved.map((attachment) => attachment.fileName).join(', '));
    return this.present(saved);
  }

  async openForDownload(ticketId: string, attachmentId: string, user: AuthenticatedUser): Promise<{ attachment: TicketAttachmentEntity; stream: ReadStream }> {
    await this.getReadableTicket(ticketId, user);
    const attachment = await this.attachmentRepository.findOneBy({ id: attachmentId, ticketId });
    if (!attachment) throw new NotFoundException('Attachment not found');

    const path = join(this.storageDir, attachment.storageKey);
    try {
      await stat(path);
    } catch {
      throw new NotFoundException('The attachment file is missing from storage');
    }
    return { attachment, stream: createReadStream(path) };
  }

  private uploadStage(ticket: TicketEntity, user: AuthenticatedUser): AttachmentStage {
    if (ticket.assigneeId === user.id && ticket.status === TicketStatus.IN_PROGRESS) return 'resolution';
    if (ticket.requesterId === user.id) {
      if (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.REJECTED) {
        throw new ConflictException(`Files can no longer be attached because the ticket is ${ticket.status}`);
      }
      return 'submission';
    }
    if (ticket.assigneeId === user.id) {
      throw new ConflictException('Claim the ticket before attaching files to it');
    }
    throw new ForbiddenException('Only the requester or the assignee can attach files to this ticket');
  }

  private async getReadableTicket(ticketId: string, user: AuthenticatedUser): Promise<TicketEntity> {
    const ticket = await this.ticketRepository.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const allowed = user.role === 'helpdesk' || user.role === 'administrator' || ticket.requesterId === user.id || ticket.assigneeId === user.id;
    if (!allowed) throw new ForbiddenException('You are not authorized to view this ticket');
    return ticket;
  }

  private async present(attachments: TicketAttachmentEntity[]): Promise<AttachmentView[]> {
    const ids = [...new Set(attachments.map((attachment) => attachment.uploaderId))];
    const users = ids.length > 0 ? await this.userRepository.findBy({ id: In(ids) }) : [];
    const names = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));

    return attachments.map(({ storageKey: _storageKey, ...attachment }) => ({ ...attachment, uploaderName: names.get(attachment.uploaderId) }));
  }
}
