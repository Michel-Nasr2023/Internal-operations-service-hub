import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'ticket_comments' })
export class TicketCommentEntity {
  @PrimaryColumn('text')
  id!: string;

  @Index()
  @Column('text')
  ticketId!: string;

  @Column('text')
  authorId!: string;

  @Column('text')
  body!: string;

  @Column('text')
  createdAt!: string;
}
