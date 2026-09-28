import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../auth/user.entity';
import { MailModule } from '../mail/mail.module';
import { TicketEntity } from '../tickets/ticket.entity';
import { TicketsModule } from '../tickets/tickets.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, TicketEntity, AuditLogEntity]), AuthModule, AuditModule, MailModule, TicketsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
