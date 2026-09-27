import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserEntity } from './auth/user.entity';
import { TicketsModule } from './tickets/tickets.module';
import { TicketEntity } from './tickets/ticket.entity';
import { TicketCommentEntity } from './tickets/ticket-comment.entity';
import { TicketViewEntity } from './tickets/ticket-view.entity';
import { AuditLogEntity } from './audit/audit-log.entity';
import { TicketAttachmentEntity } from './tickets/ticket-attachment.entity';
import { AuditModule } from './audit/audit.module';
import { ProfileModule } from './profile/profile.module';
import { AdminModule } from './admin/admin.module';
import { PasswordResetTokenEntity } from './auth/password-reset-token.entity';
import { OutboxEmailEntity } from './mail/outbox-email.entity';
import { NotificationEntity } from './notifications/notification.entity';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'data/tickets.sqlite',
      entities: [TicketEntity, UserEntity, NotificationEntity, TicketCommentEntity, TicketViewEntity, AuditLogEntity, TicketAttachmentEntity, PasswordResetTokenEntity, OutboxEmailEntity],
      synchronize: true,
    }),
    AuthModule,
    TicketsModule,
    NotificationsModule,
    AuditModule,
    ProfileModule,
    AdminModule,
  ],
})
export class AppModule {}
