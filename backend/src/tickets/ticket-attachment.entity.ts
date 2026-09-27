import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// `submission`: added by the requester with the ticket. `resolution`: added by the assignee when resolving it.
export type AttachmentStage = 'submission' | 'resolution';

// Metadata only. File bytes live in attachment storage under `storageKey` (a random ID, never the user's file name).
@Entity({ name: 'ticket_attachments' })
export class TicketAttachmentEntity {
  @PrimaryColumn('text')
  id!: string;

  @Index()
  @Column('text')
  ticketId!: string;

  @Column('text')
  uploaderId!: string;

  @Column('text')
  stage!: AttachmentStage;

  @Column('text')
  fileName!: string;

  @Column('text')
  mimeType!: string;

  @Column('integer')
  size!: number;

  @Column('text')
  storageKey!: string;

  @Column('text')
  createdAt!: string;
}
