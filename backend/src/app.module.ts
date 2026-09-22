import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserEntity } from './auth/user.entity';
import { TicketsModule } from './tickets/tickets.module';
import { TicketEntity } from './tickets/ticket.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'data/tickets.sqlite',
      entities: [TicketEntity, UserEntity],
      synchronize: true,
    }),
    AuthModule,
    TicketsModule,
  ],
})
export class AppModule {}
