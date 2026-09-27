import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from './mail.service';
import { OutboxEmailEntity } from './outbox-email.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEmailEntity])],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
