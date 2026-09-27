import { useCallback, useEffect, useState } from 'react';
import { claimTicket, getMyTickets, markTicketViewed, resolveTicket, Ticket } from '../../api/tickets';
import { TicketAiAnalysisPanel } from '../helpdesk/TicketAiAnalysisPanel';
import { uploadAttachments } from '../../api/attachments';
import { AttachmentPicker } from './AttachmentPicker';
import { TicketAttachments } from './TicketAttachments';
import { AttachmentCount } from './AttachmentCount';
import { PersonChip } from '../profile/PersonChip';
import { TicketComments } from './TicketComments';
import { TicketHistory } from './TicketHistory';
import { TicketResolutionNote } from './TicketResolutionNote';
import { SortOrder, SortSelect, sortTickets } from './ticketSort';

const TEAM_LABELS: Record<string, string> = {
  it: 'IT Operations',
  facilities: 'Facilities',
  finance: 'Finance',
};

function formatDateTime(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

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

// New for the assignee until they open it (or claim it) after it was assigned to them.
function isUnseen(ticket: Ticket): boolean {
  if (ticket.status === 'Resolved') return false;
  return !ticket.viewedAt || (!!ticket.assignedAt && ticket.viewedAt < ticket.assignedAt);
}

interface AssignedTicketsPageProps {
  userId: string;
  externalOpenTicketId?: string | null;
  onExternalOpenHandled?: () => void;
}

export function AssignedTicketsPage({ userId, externalOpenTicketId, onExternalOpenHandled }: AssignedTicketsPageProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [feedbackTicketId, setFeedbackTicketId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [resolutionFiles, setResolutionFiles] = useState<File[]>([]);
  // Errors from the Submit panel are shown inside it, not behind it on the page.
  const [feedbackError, setFeedbackError] = useState('');
  const [reviewTicketId, setReviewTicketId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

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
    if (!externalOpenTicketId) return;

    void (async () => {
      await loadTickets();
      openReview(externalOpenTicketId);
      onExternalOpenHandled?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalOpenTicketId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const replaceTicket = useCallback((updated: Ticket) => {
    setTickets((current) => current.map((ticket) => (ticket.id === updated.id ? { ...updated, viewedAt: ticket.viewedAt } : ticket)));
  }, []);

  function openReview(ticketId: string) {
    const viewedAt = new Date().toISOString();
    setTickets((current) => current.map((ticket) => (ticket.id === ticketId ? { ...ticket, viewedAt } : ticket)));
    void markTicketViewed(ticketId);
    setReviewTicketId(ticketId);
  }

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
    setResolutionFiles([]);
    setFeedbackError('');
    setFeedbackTicketId(ticketId);
  }

  async function handleSubmitFeedback() {
    if (!feedbackTicketId) return;
    const trimmed = feedback.trim();

    if (!trimmed) {
      setFeedbackError('Describe how the issue was resolved before submitting.');
      return;
    }

    setFeedbackError('');
    setNotice('');
    setBusyTicketId(feedbackTicketId);

    try {
      // Files first: if they fail to upload, the ticket stays open so nothing is lost.
      if (resolutionFiles.length > 0) {
        await uploadAttachments(feedbackTicketId, resolutionFiles);
        // Uploaded: clear them so retrying after a failed resolve does not attach them twice.
        setResolutionFiles([]);
      }
      await resolveTicket(feedbackTicketId, trimmed);
      setNotice(`Ticket ${feedbackTicketId.slice(0, 8)} resolved.`);
      setFeedbackTicketId(null);
      await loadTickets();
    } catch (actionError) {
      setFeedbackError(actionError instanceof Error ? actionError.message : 'The ticket could not be resolved.');
    } finally {
      setBusyTicketId(null);
    }
  }

  const feedbackTicket = tickets.find((ticket) => ticket.id === feedbackTicketId) ?? null;
  const reviewTicket = tickets.find((ticket) => ticket.id === reviewTicketId) ?? null;
  const newCount = tickets.filter(isUnseen).length;
  const activeCount = tickets.filter((ticket) => ticket.status === 'Assigned' || ticket.status === 'In Progress').length;

  const filteredTickets = sortTickets(tickets, sortOrder, (ticket) => ticket.assignedAt ?? ticket.createdAt).filter(
    (ticket) => statusFilter === 'all' || ticket.status === statusFilter,
  );

  return (
    <div className="service-desk">
      <section className="page-heading">
      </section>

      <section className="tickets-card" aria-labelledby="tasks-title">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2 id="tasks-title">My tasks</h2>
            <div className="queue-stats">
              <span className={newCount > 0 ? 'queue-stat-new' : undefined}><strong>{newCount}</strong> new</span>
              <span><strong>{activeCount}</strong> active</span>
            </div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={isLoading} aria-label="Refresh assigned tickets" title="Refresh assigned tickets">↻</button>
        </div>

        <div className="filter-bar">
          <SortSelect value={sortOrder} onChange={setSortOrder} />
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
                    <tr key={ticket.id} className={isUnseen(ticket) ? 'ticket-row-new' : undefined}>
                      <td className="mono">
                        {ticket.id.slice(0, 8)}
                        {isUnseen(ticket) && <span className="new-badge">New</span>}
                      </td>
                      <td>
                        {ticket.title}
                        <AttachmentCount count={ticket.attachmentCount} />
                      </td>
                      <td className="description-cell" title={ticket.aiResult?.clarifiedDescription ?? ticket.description}>{ticket.aiResult?.clarifiedDescription ?? ticket.description}</td>
                      <td className="capitalize">{ticket.priority ?? '—'}</td>
                      <td><span className={`status-pill status-${statusSlug(ticket.status)}`}>{ticket.status}</span></td>
                      <td className="mono">{ticket.status === 'In Progress' ? formatCountdown(ticket.dueAt, now) : '—'}</td>
                      <td>
                        <div className="row-action-icons">
                          <button type="button" className="review-button review-button-outline" onClick={() => openReview(ticket.id)}>
                            Review
                          </button>
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

      {reviewTicket && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="assignee-review-title" onClick={() => setReviewTicketId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">TICKET {reviewTicket.id.slice(0, 8)}</p>
                <h2 id="assignee-review-title">{reviewTicket.title}</h2>
              </div>
              <button type="button" className="icon-button modal-close" aria-label="Close ticket details" onClick={() => setReviewTicketId(null)}>✕</button>
            </div>

            <dl className="modal-meta">
              <div><dt>Requester</dt><dd><PersonChip userId={reviewTicket.requesterId} name={reviewTicket.requesterName} avatarUpdatedAt={reviewTicket.requesterAvatarUpdatedAt} /></dd></div>
              <div><dt>Team</dt><dd>{TEAM_LABELS[reviewTicket.teamId] ?? reviewTicket.teamId}</dd></div>
              <div><dt>Type</dt><dd className="capitalize">{reviewTicket.issueType}</dd></div>
              <div><dt>Project</dt><dd>{reviewTicket.project}</dd></div>
              <div><dt>Status</dt><dd><span className={`status-pill status-${statusSlug(reviewTicket.status)}`}>{reviewTicket.status}</span></dd></div>
              <div><dt>Priority</dt><dd className="capitalize">{reviewTicket.priority ?? '—'}</dd></div>
              <div><dt>Submitted</dt><dd>{formatDateTime(reviewTicket.createdAt)}</dd></div>
              <div><dt>Assigned</dt><dd>{formatDateTime(reviewTicket.assignedAt)}</dd></div>
              <div><dt>Expected duration</dt><dd>{reviewTicket.expectedDurationHours ? `${reviewTicket.expectedDurationHours}h` : '—'}</dd></div>
              {reviewTicket.status === 'In Progress' && <div><dt>Time remaining</dt><dd className="mono">{formatCountdown(reviewTicket.dueAt, now)}</dd></div>}
              {reviewTicket.status === 'Resolved' && <div><dt>Resolved</dt><dd>{formatDateTime(reviewTicket.resolvedAt)}</dd></div>}
            </dl>

            <TicketAiAnalysisPanel ticket={reviewTicket} onTicketUpdated={replaceTicket} />

            <TicketResolutionNote ticket={reviewTicket} />
            <TicketAttachments ticket={reviewTicket} />
            <TicketComments ticket={reviewTicket} />
            <TicketHistory ticket={reviewTicket} />
          </div>
        </div>
      )}

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
              <AttachmentPicker
                files={resolutionFiles}
                onChange={setResolutionFiles}
                label="Attachments (optional): photos of the fix, reports, logs"
                disabled={busyTicketId === feedbackTicket.id}
              />
            </div>

            {feedbackError && <p className="message error" role="alert">{feedbackError}</p>}

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
