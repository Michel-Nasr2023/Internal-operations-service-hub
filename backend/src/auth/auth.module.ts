import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { PasswordResetTokenEntity } from './password-reset-token.entity';
import { PasswordResetService } from './password-reset.service';
import { SessionGuard } from './session.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserEntity } from './user.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, PasswordResetTokenEntity]), AuditModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
