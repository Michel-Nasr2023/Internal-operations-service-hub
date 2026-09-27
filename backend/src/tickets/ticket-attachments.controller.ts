import { Controller, Get, Param, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser } from './auth.decorator';
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_UPLOAD } from './attachment-rules';
import { TicketAttachmentsService, UploadedFileData } from './ticket-attachments.service';
import { AuthenticatedUser } from './ticket.types';

@Controller('tickets/:id/attachments')
export class TicketAttachmentsController {
  constructor(private readonly attachmentsService: TicketAttachmentsService) {}

  @Get()
  list(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attachmentsService.list(id, user);
  }

  // multipart/form-data with one or more `files` fields. Files are held in memory and checked before storing.
  @Post()
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD, { limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES_PER_UPLOAD } }))
  upload(@Param('id') id: string, @UploadedFiles() files: UploadedFileData[], @CurrentUser() user: AuthenticatedUser) {
    return this.attachmentsService.upload(id, files, user);
  }

  @Get(':attachmentId/download')
  async download(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { attachment, stream } = await this.attachmentsService.openForDownload(id, attachmentId, user);

    // Always a download, never rendered in the page; the type comes from our allow-list, not the uploader.
    response.set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `attachment; filename="${attachment.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    stream.pipe(response);
  }
}
