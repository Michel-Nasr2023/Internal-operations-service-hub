import { Module } from '@nestjs/common';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [TicketsModule],
})
export class AppModule {}
