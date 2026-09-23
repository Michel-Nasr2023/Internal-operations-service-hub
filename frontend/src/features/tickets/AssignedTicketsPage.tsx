import { useEffect, useState } from 'react';
import { claimTicket, getMyTickets, resolveTicket, Ticket } from '../../api/tickets';

function statusSlug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '-');
}

function formatCountdown(dueAt: string | undefined, now: number): string {
  if (!dueAt) return '—';
  const remainingMs = new Date(dueAt).getTime() - now;
  if (remainingMs <= 0) return 'Overdue';

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const STATUS_OPTIONS = ['Assigned', 'In Progress', 'Resolved'] as const;

interface AssignedTicketsPageProps {
  userId: string;
}

export function AssignedTicketsPage({ userId }: AssignedTicketsPageProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [feedbackTicketId, setFeedbackTicketId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  async function loadTickets() {
    setIsLoading(true);

    try {
      const allTickets = await getMyTickets();
      setTickets(allTickets.filter((ticket) => ticket.assigneeId === userId));
    } catch (loadingError) {
      setError(loadingError instanceof Error ? loadingError.message : 'Your assigned tickets could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleClaim(ticket: Ticket) {
    setError('');
    setNotice('');
    setBusyTicketId(ticket.id);

    try {
      await claimTicket(ticket.id);
      setNotice(`Ticket ${ticket.id.slice(0, 8)} claimed. The timer has started.`);
      await loadTickets();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The ticket could not be claimed.');
    } finally {
      setBusyTicketId(null);
    }
  }

  function openFeedback(ticketId: string) {
    setFeedback('');
    setFeedbackTicketId(ticketId);
  }

  async function handleSubmitFeedback() {
    if (!feedbackTicketId) return;
    const trimmed = feedback.trim();

    if (!trimmed) {
      setError('Feedback is required to resolve the ticket.');
      return;
    }

    setError('');
    setNotice('');
    setBusyTicketId(feedbackTicketId);

    try {
      await resolveTicket(feedbackTicketId, trimmed);
      setNotice(`Ticket ${feedbackTicketId.slice(0, 8)} resolved.`);
      setFeedbackTicketId(null);
      await loadTickets();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The ticket could not be resolved.');
    } finally {
      setBusyTicketId(null);
    }
  }

  const feedbackTicket = tickets.find((ticket) => ticket.id === feedbackTicketId) ?? null;
  const activeCount = tickets.filter((ticket) => ticket.status === 'Assigned' || ticket.status === 'In Progress').length;

  const filteredTickets = tickets.filter((ticket) => statusFilter === 'all' || ticket.status === statusFilter);

  return (
    <div className="service-desk">
      <section className="page-heading">
      </section>

      <section className="tickets-card" aria-labelledby="tasks-title">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2 id="tasks-title">My tasks</h2>
            <div className="queue-stats">
              <span><strong>{activeCount}</strong> active</span>
            </div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={isLoading} aria-label="Refresh assigned tickets" title="Refresh assigned tickets">↻</button>
        </div>

        <div className="filter-bar">
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="message error" role="alert">{error}</p>}
        {notice && <p className="message success" role="status">{notice}</p>}

        {isLoading && <p className="empty-state">Loading assigned tickets...</p>}
        {!isLoading && tickets.length === 0 && <p className="empty-state">No tickets are assigned to you yet.</p>}
        {!isLoading && tickets.length > 0 && filteredTickets.length === 0 && <p className="empty-state">No tickets match the current filters.</p>}

        {!isLoading && filteredTickets.length > 0 && (
          <div className="table-scroll">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Subject</th>
                  <th>Description</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Time remaining</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => {
                  const isBusy = busyTicketId === ticket.id;
                  const canClaim = ticket.status === 'Assigned' && !isBusy;
                  const canSubmit = ticket.status === 'In Progress' && !isBusy;

                  return (
                    <tr key={ticket.id}>
                      <td className="mono">{ticket.id.slice(0, 8)}</td>
                      <td>{ticket.title}</td>
                      <td className="description-cell" title={ticket.description}>{ticket.description}</td>
                      <td className="capitalize">{ticket.priority ?? '—'}</td>
                      <td><span className={`status-pill status-${statusSlug(ticket.status)}`}>{ticket.status}</span></td>
                      <td className="mono">{ticket.status === 'In Progress' ? formatCountdown(ticket.dueAt, now) : '—'}</td>
                      <td>
                        <div className="row-action-icons">
                          <button
                            type="button"
                            className={canClaim ? 'review-button review-button-active' : 'review-button review-button-disabled'}
                            disabled={!canClaim}
                            onClick={() => void handleClaim(ticket)}
                          >
                            Claim
                          </button>
                          <button
                            type="button"
                            className={canSubmit ? 'review-button review-button-active' : 'review-button review-button-disabled'}
                            disabled={!canSubmit}
                            onClick={() => openFeedback(ticket.id)}
                          >
                            Submit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {feedbackTicket && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title" onClick={() => setFeedbackTicketId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">TICKET {feedbackTicket.id.slice(0, 8)}</p>
                <h2 id="feedback-modal-title">{feedbackTicket.title}</h2>
              </div>
              <button type="button" className="icon-button modal-close" aria-label="Close" onClick={() => setFeedbackTicketId(null)}>✕</button>
            </div>

            <div className="modal-description">
              <label>
                Describe how the issue was resolved
                <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={4} placeholder="Explain what was done to resolve this ticket." />
              </label>
            </div>

            <div className="modal-actions">
              <div className="modal-action-group">
                <button type="button" className="action-confirm" disabled={busyTicketId === feedbackTicket.id} onClick={() => void handleSubmitFeedback()}>Submit and resolve</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
