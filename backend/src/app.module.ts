import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketsModule } from './tickets/tickets.module';
import { TicketEntity } from './tickets/ticket.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'data/tickets.sqlite',
      entities: [TicketEntity],
      synchronize: true,
    }),
    TicketsModule,
  ],
})
export class AppModule {}
