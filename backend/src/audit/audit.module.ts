import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../auth/user.entity';
import { TicketEntity } from '../tickets/ticket.entity';
import { ApiExceptionFilter } from './api-exception.filter';
import { AuditLogEntity } from './audit-log.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { requestContextMiddleware } from './request-context';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity, TicketEntity, UserEntity])],
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('{*splat}');
  }
}
