import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DATABASE_FILE } from './common/env';
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
import { BackupService } from './system/backup.service';
import { HealthController } from './system/health.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: DATABASE_FILE,
      entities: [TicketEntity, UserEntity, NotificationEntity, TicketCommentEntity, TicketViewEntity, AuditLogEntity, TicketAttachmentEntity, PasswordResetTokenEntity, OutboxEmailEntity],
      synchronize: true,
      // When the file is briefly locked (another write, a backup, a sync client), wait up to 5 s instead of failing.
      busyTimeout: 5000,
      // Every request shares this one SQLite connection, so a transaction opened by one request would also
      // contain other requests' statements, and its rollback could undo their saved work. The code therefore
      // opens no transactions: each write is one insert/update statement, which SQLite applies atomically
      // (repository.save() is not used because it wraps its statement in a transaction).
    }),
    AuthModule,
    TicketsModule,
    NotificationsModule,
    AuditModule,
    ProfileModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [BackupService],
})
export class AppModule {}
