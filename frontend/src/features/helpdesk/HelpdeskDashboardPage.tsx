import { useEffect, useState } from 'react';
import { approveTicket, assignTicket, getTickets, rejectTicket, Ticket } from '../../api/tickets';
import { DirectoryUser, listAssignableEmployees } from '../../api/auth';

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

function displayStatus(status: string): string {
  return status === 'Pending Helpdesk Review' ? 'Pending' : status;
}

interface HelpdeskDashboardPageProps {
  externalOpenTicketId?: string | null;
  onExternalOpenHandled?: () => void;
}

export function HelpdeskDashboardPage({ externalOpenTicketId, onExternalOpenHandled }: HelpdeskDashboardPageProps = {}) {
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
  const [searchTerm, setSearchTerm] = useState('');

  async function loadEmployees() {
    try {
      setEmployees(await listAssignableEmployees());
    } catch {
      // The assign dropdown will just show no options if the directory cannot be loaded.
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
    return drafts[ticketId] ?? defaultDraft;
  }

  function updateDraft(ticketId: string, patch: Partial<RowDraft>) {
    setDrafts((current) => ({ ...current, [ticketId]: { ...getDraft(ticketId), ...patch } }));
  }

  function openReview(ticketId: string) {
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
      await approveTicket(ticket.id, draft.priority);
      await assignTicket(ticket.id, assigneeId, expectedDurationHours);
      setNotice(`Ticket ${ticket.id.slice(0, 8)} approved and assigned.`);
      closeReview();
      await loadTickets();
    } catch (actionError) {
      setModalError(actionError instanceof Error ? actionError.message : 'The ticket could not be approved and assigned.');
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
    } finally {
      setBusyTicketId(null);
    }
  }

  const pendingCount = tickets.filter((ticket) => ticket.status === 'Pending Helpdesk Review').length;
  const approvedCount = tickets.filter((ticket) => ticket.status === 'Approved').length;
  const openCount = tickets.filter((ticket) => ticket.status !== 'Resolved' && ticket.status !== 'Rejected').length;
  const reviewTicket = tickets.find((ticket) => ticket.id === reviewTicketId) ?? null;

  const filteredTickets = tickets.filter((ticket) => {
    if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
    if (teamFilter !== 'all' && ticket.teamId !== teamFilter) return false;
    if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false;

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      const haystack = `${ticket.title} ${ticket.description} ${ticket.requesterId} ${ticket.id}`.toLowerCase();
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
              <span><strong>{pendingCount}</strong> awaiting review</span>
              <span><strong>{approvedCount}</strong> approved, unassigned</span>
              <span><strong>{openCount}</strong> open</span>
            </div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={isLoading} aria-label="Refresh ticket queue" title="Refresh ticket queue">↻</button>
        </div>

        <div className="filter-bar">
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
          <label className="filter-search">
            Search
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by title, requester, or ticket ID" />
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
                  <th>Description</th>
                  <th>Requester</th>
                  <th>Team</th>
                  <th>Type</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Submitted</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="mono">{ticket.id.slice(0, 8)}</td>
                    <td>{ticket.title}</td>
                    <td className="description-cell" title={ticket.description}>{ticket.description}</td>
                    <td className="mono">{ticket.requesterId}</td>
                    <td>{TEAM_LABELS[ticket.teamId] ?? ticket.teamId}</td>
                    <td className="capitalize">{ticket.issueType}</td>
                    <td>{ticket.project}</td>
                    <td><span className={`status-pill status-${statusSlug(ticket.status)}`}>{displayStatus(ticket.status)}</span></td>
                    <td className="capitalize">{ticket.priority ?? '—'}</td>
                    <td>{new Date(ticket.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button type="button" className="review-button" onClick={() => openReview(ticket.id)}>Review</button>
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
              <div><dt>Requester</dt><dd className="mono">{reviewTicket.requesterId}</dd></div>
              <div><dt>Team</dt><dd>{TEAM_LABELS[reviewTicket.teamId] ?? reviewTicket.teamId}</dd></div>
              <div><dt>Type</dt><dd className="capitalize">{reviewTicket.issueType}</dd></div>
              <div><dt>Status</dt><dd><span className={`status-pill status-${statusSlug(reviewTicket.status)}`}>{reviewTicket.status}</span></dd></div>
              <div><dt>Priority</dt><dd className="capitalize">{reviewTicket.priority ?? '—'}</dd></div>
              <div><dt>Submitted</dt><dd>{new Date(reviewTicket.createdAt).toLocaleString()}</dd></div>
            </dl>

            <div className="modal-description">
              <p className="eyebrow">DESCRIPTION</p>
              <p>{reviewTicket.description}</p>
            </div>

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
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>
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
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>
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
          </div>
        </div>
      )}
    </div>
  );
}
