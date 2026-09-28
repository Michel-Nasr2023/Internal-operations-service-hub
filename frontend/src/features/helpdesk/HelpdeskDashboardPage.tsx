import { useCallback, useEffect, useState } from 'react';
import { approveTicket, assignTicket, getTickets, markTicketViewed, rejectTicket, Ticket } from '../../api/tickets';
import { DirectoryUser, listAssignableEmployees } from '../../api/auth';
import { TicketAiAnalysisPanel } from './TicketAiAnalysisPanel';
import { TicketAttachments } from '../tickets/TicketAttachments';
import { PersonChip } from '../profile/PersonChip';
import { DateCell, labelCase, StackedCell, SubjectCell } from '../tickets/TableCells';
import { TicketComments } from '../tickets/TicketComments';
import { TicketHistory } from '../tickets/TicketHistory';
import { TicketResolutionNote } from '../tickets/TicketResolutionNote';
import { SortOrder, SortSelect, sortTickets } from '../tickets/ticketSort';
import { computeWorkload, LOAD_LABELS } from './workload';

const TEAM_LABELS: Record<string, string> = {
  it: 'IT Operations',
  facilities: 'Facilities',
  finance: 'Finance',
};

const STATUS_OPTIONS = ['Pending Helpdesk Review', 'Approved', 'Rejected', 'Assigned', 'In Progress', 'Resolved'] as const;
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;

type ActionStage = 'choose' | 'approve' | 'reject';

interface RowDraft {
  priority: string;
  rejectReason: string;
  assigneeId: string;
  expectedDurationHours: string;
}

const defaultDraft: RowDraft = {
  priority: 'medium',
  rejectReason: '',
  assigneeId: '',
  expectedDurationHours: '8',
};

function statusSlug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '-');
}

// New for this Helpdesk user until they open it with Review; closed tickets are never "new".
function isUnseen(ticket: Ticket): boolean {
  return !ticket.viewedAt && ticket.status !== 'Resolved' && ticket.status !== 'Rejected';
}

// One label when the same Helpdesk member approved and assigned the ticket; separate lines only when they differ.
function reviewerLabel(ticket: Ticket): string {
  if (ticket.status === 'Rejected') return 'Rejected by';
  return ticket.assignedBy && ticket.assignedBy === ticket.reviewedBy ? 'Approved & assigned by' : 'Approved by';
}

function isOverdue(ticket: Ticket, now: number): boolean {
  return ticket.status === 'In Progress' && !!ticket.dueAt && new Date(ticket.dueAt).getTime() <= now;
}

function displayStatus(status: string): string {
  return status === 'Pending Helpdesk Review' ? 'Pending' : status;
}

interface HelpdeskDashboardPageProps {
  // The signed-in Helpdesk member, for the "Handled by me" filter.
  currentUserId: string;
  externalOpenTicketId?: string | null;
  onExternalOpenHandled?: () => void;
}

export function HelpdeskDashboardPage({ currentUserId, externalOpenTicketId, onExternalOpenHandled }: HelpdeskDashboardPageProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [reviewTicketId, setReviewTicketId] = useState<string | null>(null);
  const [actionStage, setActionStage] = useState<ActionStage>('choose');
  const [modalError, setModalError] = useState('');
  const [employees, setEmployees] = useState<DirectoryUser[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [handledFilter, setHandledFilter] = useState<'all' | 'me'>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [searchTerm, setSearchTerm] = useState('');

  async function loadEmployees() {
    try {
      setEmployees(await listAssignableEmployees());
    } catch {
      // The assign dropdown will just show no options if the directory cannot be loaded.
    }
  }

  // Re-reads the queue without the loading state, so an open review panel shows the ticket's real status
  // after an action fails (for example if someone else already handled it).
  async function refreshQuietly() {
    try {
      setTickets(await getTickets());
    } catch {
      // The error already shown to the user is enough.
    }
  }

  async function loadTickets() {
    setIsLoading(true);

    try {
      setTickets(await getTickets());
    } catch (loadingError) {
      setError(loadingError instanceof Error ? loadingError.message : 'The ticket queue could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadTickets();
    void loadEmployees();
  }, []);

  useEffect(() => {
    if (!externalOpenTicketId) return;

    void (async () => {
      await loadTickets();
      openReview(externalOpenTicketId);
      onExternalOpenHandled?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalOpenTicketId]);

  function getDraft(ticketId: string): RowDraft {
    // Pre-select the AI-suggested severity as the priority; Helpdesk can still change it.
    const analysis = tickets.find((ticket) => ticket.id === ticketId)?.aiResult;
    const suggestedPriority = analysis?.source === 'ai' ? analysis.severity : undefined;
    return drafts[ticketId] ?? { ...defaultDraft, priority: suggestedPriority ?? defaultDraft.priority };
  }

  function updateDraft(ticketId: string, patch: Partial<RowDraft>) {
    setDrafts((current) => ({ ...current, [ticketId]: { ...getDraft(ticketId), ...patch } }));
  }

  // Merges a refreshed ticket (finished or restarted AI analysis) into the queue, keeping this user's view state.
  const replaceTicket = useCallback((updated: Ticket) => {
    setTickets((current) => current.map((ticket) => (ticket.id === updated.id ? { ...updated, viewedAt: ticket.viewedAt } : ticket)));
  }, []);

  function openReview(ticketId: string) {
    const viewedAt = new Date().toISOString();
    setTickets((current) => current.map((ticket) => (ticket.id === ticketId ? { ...ticket, viewedAt } : ticket)));
    void markTicketViewed(ticketId);
    setReviewTicketId(ticketId);
    setActionStage('choose');
    setModalError('');
  }

  function closeReview() {
    setReviewTicketId(null);
    setActionStage('choose');
    setModalError('');
  }

  async function handleApproveAndAssign(ticket: Ticket) {
    const draft = getDraft(ticket.id);
    const assigneeId = draft.assigneeId.trim();
    const expectedDurationHours = Number(draft.expectedDurationHours);

    if (!assigneeId) {
      setModalError('An assignee is required.');
      return;
    }
    if (!Number.isFinite(expectedDurationHours) || expectedDurationHours <= 0) {
      setModalError('Expected duration must be a positive number of hours.');
      return;
    }

    setModalError('');
    setNotice('');
    setBusyTicketId(ticket.id);

    try {
      await approveTicket(ticket.id, draft.priority, { assigneeId, expectedDurationHours });
      setNotice(`Ticket ${ticket.id.slice(0, 8)} approved and assigned.`);
      closeReview();
      await loadTickets();
    } catch (actionError) {
      setModalError(actionError instanceof Error ? actionError.message : 'The ticket could not be approved and assigned.');
      await refreshQuietly();
    } finally {
      setBusyTicketId(null);
    }
  }

  async function handleReject(ticket: Ticket) {
    const reason = getDraft(ticket.id).rejectReason.trim();
    if (!reason) {
      setModalError('A rejection reason is required.');
      return;
    }

    setModalError('');
    setNotice('');
    setBusyTicketId(ticket.id);

    try {
      await rejectTicket(ticket.id, reason);
      setNotice(`Ticket ${ticket.id.slice(0, 8)} rejected.`);
      closeReview();
      await loadTickets();
    } catch (actionError) {
      setModalError(actionError instanceof Error ? actionError.message : 'The ticket could not be rejected.');
      await refreshQuietly();
    } finally {
      setBusyTicketId(null);
    }
  }

  async function handleAssign(ticket: Ticket) {
    const draft = getDraft(ticket.id);
    const assigneeId = draft.assigneeId.trim();
    const expectedDurationHours = Number(draft.expectedDurationHours);

    if (!assigneeId) {
      setModalError('An assignee is required.');
      return;
    }
    if (!Number.isFinite(expectedDurationHours) || expectedDurationHours <= 0) {
      setModalError('Expected duration must be a positive number of hours.');
      return;
    }

    setModalError('');
    setNotice('');
    setBusyTicketId(ticket.id);

    try {
      await assignTicket(ticket.id, assigneeId, expectedDurationHours);
      setNotice(`Ticket ${ticket.id.slice(0, 8)} assigned to ${assigneeId}.`);
      closeReview();
      await loadTickets();
    } catch (actionError) {
      setModalError(actionError instanceof Error ? actionError.message : 'The ticket could not be assigned.');
      await refreshQuietly();
    } finally {
      setBusyTicketId(null);
    }
  }

  const newCount = tickets.filter(isUnseen).length;
  const pendingCount = tickets.filter((ticket) => ticket.status === 'Pending Helpdesk Review').length;
  const approvedCount = tickets.filter((ticket) => ticket.status === 'Approved').length;
  const openCount = tickets.filter((ticket) => ticket.status !== 'Resolved' && ticket.status !== 'Rejected').length;
  const inProgressCount = tickets.filter((ticket) => ticket.status === 'In Progress').length;
  const now = Date.now();
  const overdueCount = tickets.filter((ticket) => isOverdue(ticket, now)).length;
  const reviewTicket = tickets.find((ticket) => ticket.id === reviewTicketId) ?? null;
  // Least-loaded people first, with their current load in the label, so Helpdesk can spread work fairly.
  const assigneeOptions = computeWorkload(employees, tickets, now)
    .sort((a, b) => a.active - b.active || `${a.employee.firstName} ${a.employee.lastName}`.localeCompare(`${b.employee.firstName} ${b.employee.lastName}`))
    .map((row) => ({
      id: row.employee.id,
      label: `${row.employee.firstName} ${row.employee.lastName} — ${row.active} active${row.overdue > 0 ? `, ${row.overdue} overdue` : ''}${row.level === 'high' ? ` (${LOAD_LABELS.high})` : ''}`,
    }));

  const filteredTickets = sortTickets(tickets, sortOrder).filter((ticket) => {
    if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
    if (teamFilter !== 'all' && ticket.teamId !== teamFilter) return false;
    if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false;
    if (handledFilter === 'me' && ticket.reviewedBy !== currentUserId && ticket.assignedBy !== currentUserId) return false;

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      const haystack = `${ticket.title} ${ticket.description} ${ticket.aiResult?.clarifiedDescription ?? ''} ${ticket.requesterName ?? ''} ${ticket.requesterId} ${ticket.id}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    return true;
  });

  return (
    <div className="service-desk">
      <section className="page-heading">
      </section>

      <section className="tickets-card" aria-labelledby="queue-title">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2 id="queue-title">Tickets queue</h2>
            <div className="queue-stats">
              <span className={newCount > 0 ? 'queue-stat-new' : undefined}><strong>{newCount}</strong> new</span>
              <span><strong>{pendingCount}</strong> awaiting review</span>
              <span><strong>{approvedCount}</strong> approved, unassigned</span>
              <span><strong>{openCount}</strong> open</span>
              <span><strong>{inProgressCount}</strong> in progress</span>
              <span className={overdueCount > 0 ? 'queue-stat-alert' : undefined}><strong>{overdueCount}</strong> overdue</span>
            </div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={isLoading} aria-label="Refresh ticket queue" title="Refresh ticket queue">↻</button>
        </div>

        <div className="filter-bar">
          <SortSelect value={sortOrder} onChange={setSortOrder} />
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{displayStatus(status)}</option>
              ))}
            </select>
          </label>
          <label>
            Team
            <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
              <option value="all">All teams</option>
              <option value="it">IT Operations</option>
              <option value="facilities">Facilities</option>
              <option value="finance">Finance</option>
            </select>
          </label>
          <label>
            Priority
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">All priorities</option>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Handled by
            <select value={handledFilter} onChange={(event) => setHandledFilter(event.target.value as 'all' | 'me')}>
              <option value="all">Anyone</option>
              <option value="me">Me (reviewed or assigned)</option>
            </select>
          </label>
          <label className="filter-search">
            Search
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by title, requester name, or ticket ID" />
          </label>
        </div>

        {error && <p className="message error" role="alert">{error}</p>}
        {notice && <p className="message success" role="status">{notice}</p>}

        {isLoading && <p className="empty-state">Loading ticket queue...</p>}
        {!isLoading && tickets.length === 0 && <p className="empty-state">No tickets have been submitted yet.</p>}
        {!isLoading && tickets.length > 0 && filteredTickets.length === 0 && <p className="empty-state">No tickets match the current filters.</p>}

        {!isLoading && filteredTickets.length > 0 && (
          <div className="table-scroll">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Subject</th>
                  <th>Requester</th>
                  <th>Team · Type</th>
                  <th>Project / area</th>
                  <th>Status</th>
                  <th>Assigned by</th>
                  <th>Priority</th>
                  <th>Submitted</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => (
                  <tr key={ticket.id} className={isUnseen(ticket) ? 'ticket-row-new' : undefined}>
                    <td className="mono">
                      {ticket.id.slice(0, 8)}
                      {isUnseen(ticket) && <span className="new-badge">New</span>}
                    </td>
                    <td><SubjectCell ticket={ticket} /></td>
                    <td><PersonChip userId={ticket.requesterId} name={ticket.requesterName} avatarUpdatedAt={ticket.requesterAvatarUpdatedAt} /></td>
                    <td><StackedCell primary={TEAM_LABELS[ticket.teamId] ?? ticket.teamId} secondary={labelCase(ticket.issueType)} /></td>
                    <td className="project-cell" title={ticket.project}>{ticket.project}</td>
                    <td>
                      <span className={`status-pill status-${statusSlug(ticket.status)}`}>{displayStatus(ticket.status)}</span>
                      {isOverdue(ticket, now) && <span className="status-pill status-rejected overdue-pill">Overdue</span>}
                    </td>
                    <td>
                      {ticket.assignedBy ? (
                        <PersonChip userId={ticket.assignedBy} name={ticket.assignedBy === currentUserId ? 'You' : ticket.assignedByName} avatarUpdatedAt={ticket.assignedByAvatarUpdatedAt} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="capitalize">{ticket.priority ?? '—'}</td>
                    <td><DateCell value={ticket.createdAt} /></td>
                    <td>
                      <button type="button" className="review-button review-button-outline" onClick={() => openReview(ticket.id)}>Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reviewTicket && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="review-modal-title" onClick={closeReview}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">TICKET {reviewTicket.id.slice(0, 8)}</p>
                <h2 id="review-modal-title">{reviewTicket.title}</h2>
              </div>
              <button type="button" className="icon-button modal-close" aria-label="Close review" onClick={closeReview}>✕</button>
            </div>

            <dl className="modal-meta">
              <div><dt>Requester</dt><dd><PersonChip userId={reviewTicket.requesterId} name={reviewTicket.requesterName} avatarUpdatedAt={reviewTicket.requesterAvatarUpdatedAt} /></dd></div>
              <div><dt>Team</dt><dd>{TEAM_LABELS[reviewTicket.teamId] ?? reviewTicket.teamId}</dd></div>
              <div><dt>Type</dt><dd className="capitalize">{reviewTicket.issueType}</dd></div>
              <div><dt>Project / area</dt><dd>{reviewTicket.project}</dd></div>
              <div><dt>Status</dt><dd><span className={`status-pill status-${statusSlug(reviewTicket.status)}`}>{reviewTicket.status}</span></dd></div>
              <div><dt>Priority</dt><dd className="capitalize">{reviewTicket.priority ?? '—'}</dd></div>
              <div><dt>Submitted</dt><dd>{new Date(reviewTicket.createdAt).toLocaleString()}</dd></div>
              {reviewTicket.reviewedBy && (
                <div>
                  <dt>{reviewerLabel(reviewTicket)}</dt>
                  <dd><PersonChip userId={reviewTicket.reviewedBy} name={reviewTicket.reviewedByName} avatarUpdatedAt={reviewTicket.reviewedByAvatarUpdatedAt} /></dd>
                </div>
              )}
              {reviewTicket.assigneeId && <div><dt>Assignee</dt><dd><PersonChip userId={reviewTicket.assigneeId} name={reviewTicket.assigneeName} avatarUpdatedAt={reviewTicket.assigneeAvatarUpdatedAt} /></dd></div>}
              {reviewTicket.assignedBy && reviewTicket.assignedBy !== reviewTicket.reviewedBy && (
                <div>
                  <dt>Assigned by</dt>
                  <dd><PersonChip userId={reviewTicket.assignedBy} name={reviewTicket.assignedByName} avatarUpdatedAt={reviewTicket.assignedByAvatarUpdatedAt} /></dd>
                </div>
              )}
              {reviewTicket.dueAt && <div><dt>Due</dt><dd>{new Date(reviewTicket.dueAt).toLocaleString()}{isOverdue(reviewTicket, now) ? ' · Overdue' : ''}</dd></div>}
            </dl>

            <TicketAiAnalysisPanel ticket={reviewTicket} onTicketUpdated={replaceTicket} canRetry />
            <TicketResolutionNote ticket={reviewTicket} />
            <TicketAttachments ticket={reviewTicket} />

            {modalError && <p className="message error" role="alert">{modalError}</p>}

            {reviewTicket.status === 'Pending Helpdesk Review' && actionStage === 'choose' && (
              <div className="modal-actions">
                <div className="modal-action-group">
                  <button type="button" className="action-confirm" onClick={() => { setModalError(''); setActionStage('approve'); }}>Approve</button>
                  <button type="button" className="action-confirm action-confirm-reject" onClick={() => { setModalError(''); setActionStage('reject'); }}>Reject</button>
                </div>
              </div>
            )}

            {reviewTicket.status === 'Pending Helpdesk Review' && actionStage === 'approve' && (
              <div className="modal-actions">
                <div className="modal-action-group">
                  <label>
                    Priority
                    <select
                      value={getDraft(reviewTicket.id).priority}
                      onChange={(event) => updateDraft(reviewTicket.id, { priority: event.target.value })}
                    >
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Assign to
                    <select
                      value={getDraft(reviewTicket.id).assigneeId}
                      onChange={(event) => updateDraft(reviewTicket.id, { assigneeId: event.target.value })}
                    >
                      <option value="">Select an employee</option>
                      {assigneeOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Expected hours
                    <input
                      type="number"
                      min={1}
                      value={getDraft(reviewTicket.id).expectedDurationHours}
                      onChange={(event) => updateDraft(reviewTicket.id, { expectedDurationHours: event.target.value })}
                    />
                  </label>
                  <button type="button" className="action-confirm" disabled={busyTicketId === reviewTicket.id} onClick={() => void handleApproveAndAssign(reviewTicket)}>Assign</button>
                </div>
              </div>
            )}

            {reviewTicket.status === 'Pending Helpdesk Review' && actionStage === 'reject' && (
              <div className="modal-actions">
                <div className="modal-action-group">
                  <label>
                    Rejection reason
                    <input
                      value={getDraft(reviewTicket.id).rejectReason}
                      onChange={(event) => updateDraft(reviewTicket.id, { rejectReason: event.target.value })}
                      placeholder="Explain why this request is rejected"
                    />
                  </label>
                  <button type="button" className="action-confirm action-confirm-reject" disabled={busyTicketId === reviewTicket.id} onClick={() => void handleReject(reviewTicket)}>Submit</button>
                </div>
              </div>
            )}

            {reviewTicket.status === 'Approved' && (
              <div className="modal-actions">
                <div className="modal-action-group">
                  <label>
                    Assign to
                    <select
                      value={getDraft(reviewTicket.id).assigneeId}
                      onChange={(event) => updateDraft(reviewTicket.id, { assigneeId: event.target.value })}
                    >
                      <option value="">Select an employee</option>
                      {assigneeOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Expected hours
                    <input
                      type="number"
                      min={1}
                      value={getDraft(reviewTicket.id).expectedDurationHours}
                      onChange={(event) => updateDraft(reviewTicket.id, { expectedDurationHours: event.target.value })}
                    />
                  </label>
                  <button type="button" className="action-confirm" disabled={busyTicketId === reviewTicket.id} onClick={() => void handleAssign(reviewTicket)}>Assign</button>
                </div>
              </div>
            )}

            {reviewTicket.status !== 'Pending Helpdesk Review' && reviewTicket.status !== 'Approved' && (
              <p className="empty-state">No action is required for this ticket.</p>
            )}

            <TicketComments ticket={reviewTicket} />
            <TicketHistory ticket={reviewTicket} />
          </div>
        </div>
      )}
    </div>
  );
}
