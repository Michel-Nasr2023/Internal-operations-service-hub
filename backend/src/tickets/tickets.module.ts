import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketEntity } from './ticket.entity';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { RqstyAiService } from '../ai/rqsty-ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([TicketEntity])],
  controllers: [TicketsController],
  providers: [TicketsService, RqstyAiService],
})
export class TicketsModule {}
