import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketCommentEntity } from './ticket-comment.entity';
import { TicketViewEntity } from './ticket-view.entity';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { RqstyAiService } from '../ai/rqsty-ai.service';
import { TicketAnalysisQueue } from './ticket-analysis.queue';
import { TicketAttachmentEntity } from './ticket-attachment.entity';
import { TicketAttachmentsController } from './ticket-attachments.controller';
import { TicketAttachmentsService } from './ticket-attachments.service';
import { UserEntity } from '../auth/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([TicketEntity, UserEntity, TicketCommentEntity, TicketViewEntity, TicketAttachmentEntity]), NotificationsModule, AuditModule],
  controllers: [TicketsController, TicketAttachmentsController],
  providers: [TicketsService, RqstyAiService, TicketAnalysisQueue, TicketAttachmentsService],
})
export class TicketsModule {}
