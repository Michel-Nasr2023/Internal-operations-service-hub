import { Column, Entity, PrimaryColumn } from 'typeorm';

// When each user last opened a ticket's details; drives the "new" highlight in ticket tables.
@Entity({ name: 'ticket_views' })
export class TicketViewEntity {
  @PrimaryColumn('text')
  userId!: string;

  @PrimaryColumn('text')
  ticketId!: string;

  @Column('text')
  viewedAt!: string;
}
