import { Ticket } from '../../api/tickets';

interface TicketResolutionNoteProps {
  ticket: Ticket;
}

// How the assignee resolved the ticket, shown once it is Resolved.
export function TicketResolutionNote({ ticket }: TicketResolutionNoteProps) {
  if (ticket.status !== 'Resolved') return null;

  const resolvedBy = ticket.assigneeName ?? ticket.assigneeId;

  return (
    <section className="resolution-note" aria-label="Resolution">
      <p className="eyebrow">RESOLUTION</p>
      <p>{ticket.resolutionFeedback ?? 'No resolution notes were provided.'}</p>
      <small>
        {resolvedBy ? `Resolved by ${resolvedBy}` : 'Resolved'}
        {ticket.resolvedAt ? ` · ${new Date(ticket.resolvedAt).toLocaleString()}` : ''}
      </small>
    </section>
  );
}
