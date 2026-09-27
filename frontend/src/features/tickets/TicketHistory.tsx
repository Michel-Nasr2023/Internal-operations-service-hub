import { useEffect, useState } from 'react';
import { getTicketHistory, TicketHistoryEvent } from '../../api/audit';
import { Ticket } from '../../api/tickets';

const ACTION_LABELS: Record<string, string> = {
  TICKET_SUBMITTED: 'Submitted the ticket',
  TICKET_APPROVED: 'Approved the ticket',
  TICKET_REJECTED: 'Rejected the ticket',
  PRIORITY_CHANGED: 'Changed the priority',
  TICKET_ASSIGNED: 'Assigned the ticket',
  TICKET_CLAIMED: 'Claimed the ticket and started work',
  TICKET_RESOLVED: 'Resolved the ticket',
  COMMENT_ADDED: 'Added a comment',
};

interface TicketHistoryProps {
  ticket: Ticket;
}

// Workflow history of one ticket (who did what, when). Collapsed by default to keep the panel short.
export function TicketHistory({ ticket }: TicketHistoryProps) {
  const [events, setEvents] = useState<TicketHistoryEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let isCurrent = true;
    setEvents(null);
    setError('');

    getTicketHistory(ticket.id)
      .then((loaded) => isCurrent && setEvents(loaded))
      .catch((loadError) => isCurrent && setError(loadError instanceof Error ? loadError.message : 'The ticket history could not be loaded.'));

    return () => {
      isCurrent = false;
    };
    // Reload when the ticket changes state so a newly added step shows up.
  }, [ticket.id, ticket.status]);

  return (
    <details className="ticket-history">
      <summary>History{events ? ` (${events.length})` : ''}</summary>

      {error && <p className="message error" role="alert">{error}</p>}
      {!events && !error && <p className="empty-state">Loading history...</p>}

      {events && events.length > 0 && (
        <ol className="history-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className="history-dot" aria-hidden="true" />
              <div>
                <strong>{ACTION_LABELS[event.action] ?? event.action.replace(/_/g, ' ').toLowerCase()}</strong>
                <small>
                  {event.actorName ?? event.actorId} · {new Date(event.timestamp).toLocaleString()}
                  {event.newStatus && event.oldStatus !== event.newStatus ? ` · ${event.oldStatus ?? 'Created'} → ${event.newStatus}` : ''}
                </small>
                {event.reason && <p>{event.reason}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
