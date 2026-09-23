import { FormEvent, useEffect, useState } from 'react';
import { createTicket, CreateTicketInput, getMyTickets, Ticket } from '../../api/tickets';

const initialForm: CreateTicketInput = {
  title: '',
  description: '',
  teamId: 'it',
  issueType: 'hardware',
  project: 'internal',
};

const TEAM_LABELS: Record<string, string> = {
  it: 'IT Operations',
  facilities: 'Facilities',
  finance: 'Finance',
};

const STATUS_OPTIONS = ['Pending Helpdesk Review', 'Approved', 'Rejected', 'Assigned', 'In Progress', 'Resolved'] as const;

function statusSlug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '-');
}

interface CreateTicketPageProps {
  externalOpenTicketId?: string | null;
  onExternalOpenHandled?: () => void;
}

export function CreateTicketPage({ externalOpenTicketId, onExternalOpenHandled }: CreateTicketPageProps = {}) {
  const [form, setForm] = useState(initialForm);
  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(true);
  const [reviewTicketId, setReviewTicketId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');

  async function loadTickets() {
    setIsLoadingTickets(true);

    try {
      setTickets(await getMyTickets());
    } catch (loadingError) {
      setError(loadingError instanceof Error ? loadingError.message : 'Your saved tickets could not be loaded.');
    } finally {
      setIsLoadingTickets(false);
    }
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  useEffect(() => {
    if (!externalOpenTicketId) return;

    void (async () => {
      await loadTickets();
      setReviewTicketId(externalOpenTicketId);
      onExternalOpenHandled?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalOpenTicketId]);

  function updateField(field: keyof CreateTicketInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    setCreatedTicket(null);

    try {
      const ticket = await createTicket(form);
      setCreatedTicket(ticket);
      setForm(initialForm);
      await loadTickets();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'The ticket could not be created.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const reviewTicket = tickets.find((ticket) => ticket.id === reviewTicketId) ?? null;

  const filteredTickets = tickets.filter((ticket) => {
    if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
    if (teamFilter !== 'all' && ticket.teamId !== teamFilter) return false;
    return true;
  });

  return (
    <div className="service-desk">
      <section className="page-heading">
      </section>

      <div className="service-desk-grid">
        <section className="form-card" aria-labelledby="form-title">
          <div className="card-heading">
            <h2 id="form-title">New ticket</h2>
            <span className="status-dot">● Ready</span>
          </div>

          <form onSubmit={handleSubmit}>
            <label>
              Subject
              <input value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder="e.g. Laptop cannot connect to Wi-Fi" maxLength={150} required />
            </label>

            <label>
              Description
              <textarea value={form.description} onChange={(event) => updateField('description', event.target.value)} placeholder="Include what happened and what you have already tried." maxLength={5000} rows={5} required />
            </label>

            <div className="field-grid field-grid-3">
              <label>
                Team
                <select value={form.teamId} onChange={(event) => updateField('teamId', event.target.value)}>
                  <option value="it">IT Operations</option>
                  <option value="facilities">Facilities</option>
                  <option value="finance">Finance</option>
                </select>
              </label>
              <label>
                Issue type
                <select value={form.issueType} onChange={(event) => updateField('issueType', event.target.value)}>
                  <option value="hardware">Hardware</option>
                  <option value="software">Software</option>
                  <option value="access">Access</option>
                </select>
              </label>
              <label>
                Project or area
                <input value={form.project} onChange={(event) => updateField('project', event.target.value)} placeholder="e.g. Internal tools" required />
              </label>
            </div>

            {error && <p className="message error" role="alert">{error}</p>}
            {createdTicket && <p className="message success" role="status">Ticket <strong>{createdTicket.id.slice(0, 8)}</strong> saved. Status: {createdTicket.status}.</p>}

            {createdTicket?.aiResult && (
              <section className="ai-result" aria-labelledby="ai-result-title">
                <p className="eyebrow">AI STRUCTURED RESULT</p>
                <h3 id="ai-result-title">Request interpreted successfully</h3>
                <dl>
                  <div><dt>Employee ID</dt><dd>{createdTicket.aiResult.employeeId}</dd></div>
                  <div><dt>Job title</dt><dd>{createdTicket.aiResult.jobTitle}</dd></div>
                  <div><dt>Issue type</dt><dd>{createdTicket.aiResult.issueType}</dd></div>
                  <div><dt>Severity</dt><dd>{createdTicket.aiResult.severity}</dd></div>
                  <div><dt>Product</dt><dd>{createdTicket.aiResult.productName}</dd></div>
                  <div><dt>Recommended action</dt><dd>{createdTicket.aiResult.recommendedAction}</dd></div>
                </dl>
              </section>
            )}

            <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit ticket'}</button>
          </form>
        </section>

        <section className="tickets-card" aria-labelledby="tickets-title">
          <div className="card-heading">
            <h2 id="tickets-title">My tickets</h2>
            <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={isLoadingTickets} aria-label="Refresh submitted tickets" title="Refresh submitted tickets">↻</button>
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
            <label>
              Team
              <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                <option value="all">All teams</option>
                <option value="it">IT Operations</option>
                <option value="facilities">Facilities</option>
                <option value="finance">Finance</option>
              </select>
            </label>
          </div>

          {isLoadingTickets && <p className="empty-state">Loading saved tickets...</p>}
          {!isLoadingTickets && tickets.length === 0 && <p className="empty-state">No tickets submitted yet.</p>}
          {!isLoadingTickets && tickets.length > 0 && filteredTickets.length === 0 && <p className="empty-state">No tickets match the current filters.</p>}

          {!isLoadingTickets && filteredTickets.length > 0 && (
            <div className="table-scroll">
              <table className="tickets-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Subject</th>
                    <th>Team</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="mono">{ticket.id.slice(0, 8)}</td>
                      <td>{ticket.title}</td>
                      <td>{TEAM_LABELS[ticket.teamId] ?? ticket.teamId}</td>
                      <td className="capitalize">{ticket.issueType}</td>
                      <td><span className={`status-pill status-${statusSlug(ticket.status)}`}>{ticket.status}</span></td>
                      <td>{new Date(ticket.createdAt).toLocaleString()}</td>
                      <td>
                        <button
                          type="button"
                          className={ticket.status === 'Pending Helpdesk Review' ? 'review-button review-button-disabled' : 'review-button review-button-active'}
                          disabled={ticket.status === 'Pending Helpdesk Review'}
                          onClick={() => setReviewTicketId(ticket.id)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {reviewTicket && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="employee-review-title" onClick={() => setReviewTicketId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">TICKET {reviewTicket.id.slice(0, 8)}</p>
                <h2 id="employee-review-title">{reviewTicket.title}</h2>
              </div>
              <button type="button" className="icon-button modal-close" aria-label="Close review" onClick={() => setReviewTicketId(null)}>✕</button>
            </div>

            <dl className="modal-meta">
              <div><dt>Team</dt><dd>{TEAM_LABELS[reviewTicket.teamId] ?? reviewTicket.teamId}</dd></div>
              <div><dt>Type</dt><dd className="capitalize">{reviewTicket.issueType}</dd></div>
              <div><dt>Status</dt><dd><span className={`status-pill status-${statusSlug(reviewTicket.status)}`}>{reviewTicket.status}</span></dd></div>
              <div><dt>Submitted</dt><dd>{new Date(reviewTicket.createdAt).toLocaleString()}</dd></div>
            </dl>

            {reviewTicket.status === 'Rejected' && (
              <div className="modal-description">
                <p className="eyebrow">REJECTION REASON</p>
                <p>{reviewTicket.rejectionReason ?? 'No reason was provided.'}</p>
              </div>
            )}

            {reviewTicket.status !== 'Rejected' && (
              <div className="modal-description">
                <p className="eyebrow">ASSIGNMENT</p>
                {reviewTicket.assigneeId ? (
                  <p>
                    Assigned to <strong>{reviewTicket.assigneeId}</strong>
                    {reviewTicket.expectedDurationHours ? ` \u00b7 Expected duration: ${reviewTicket.expectedDurationHours}h` : ''}
                    {reviewTicket.assignedAt ? ` \u00b7 Assigned on ${new Date(reviewTicket.assignedAt).toLocaleString()}` : ''}
                  </p>
                ) : (
                  <p>Approved with priority <strong className="capitalize">{reviewTicket.priority ?? 'not set'}</strong>. Awaiting Helpdesk assignment.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}