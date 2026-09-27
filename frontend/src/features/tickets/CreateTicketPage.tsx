import { FormEvent, useEffect, useState } from 'react';
import { createTicket, CreateTicketInput, getMyTickets, Ticket } from '../../api/tickets';
import { uploadAttachments } from '../../api/attachments';
import { AttachmentPicker } from './AttachmentPicker';
import { TicketAttachments } from './TicketAttachments';
import { AttachmentCount } from './AttachmentCount';
import { TicketComments } from './TicketComments';
import { TicketHistory } from './TicketHistory';
import { TicketResolutionNote } from './TicketResolutionNote';
import { SortOrder, SortSelect, sortTickets } from './ticketSort';

const initialForm: CreateTicketInput = {
  title: '',
  description: '',
  teamId: 'it',
  issueType: 'hardware',
  project: '',
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

function displayStatus(status: string): string {
  return status === 'Pending Helpdesk Review' ? 'Pending' : status;
}

interface CreateTicketPageProps {
  userId: string;
  externalOpenTicketId?: string | null;
  onExternalOpenHandled?: () => void;
}

export function CreateTicketPage({ userId, externalOpenTicketId, onExternalOpenHandled }: CreateTicketPageProps) {
  const [form, setForm] = useState(initialForm);
  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentWarning, setAttachmentWarning] = useState('');
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(true);
  const [reviewTicketId, setReviewTicketId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  async function loadTickets() {
    setIsLoadingTickets(true);

    try {
      // The API also returns tickets assigned to this user; those belong on My tasks, not here.
      setTickets((await getMyTickets()).filter((ticket) => ticket.requesterId === userId));
    } catch (loadingError) {
      setError(loadingError instanceof Error ? loadingError.message : 'Your saved tickets could not be loaded.');
    } finally {
      setIsLoadingTickets(false);
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
    setAttachmentWarning('');
    setCreatedTicket(null);

    try {
      const ticket = await createTicket(form);
      // The ticket is saved even if its files fail to upload; the employee is told and can add them later.
      if (files.length > 0) {
        try {
          await uploadAttachments(ticket.id, files);
        } catch (uploadError) {
          setAttachmentWarning(`Your ticket was saved, but the files were not attached: ${uploadError instanceof Error ? uploadError.message : 'upload failed.'} You can attach them from the ticket's Review panel.`);
        }
      }
      setCreatedTicket(ticket);
      setForm(initialForm);
      setFiles([]);
      await loadTickets();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'The ticket could not be created.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const reviewTicket = tickets.find((ticket) => ticket.id === reviewTicketId) ?? null;

  const filteredTickets = sortTickets(tickets, sortOrder).filter((ticket) => {
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

            <AttachmentPicker files={files} onChange={setFiles} label="Attachments (optional): screenshots, photos, error logs" disabled={isSubmitting} />

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
                  <option value="network">Network</option>
                  <option value="access">Access</option>
                </select>
              </label>
              <label>
                Project or area
                <input value={form.project} onChange={(event) => updateField('project', event.target.value)} placeholder="e.g. Office printer, Finance app, VPN" required />
              </label>
            </div>

            {error && <p className="message error" role="alert">{error}</p>}
            {attachmentWarning && <p className="message error" role="alert">{attachmentWarning}</p>}
            {createdTicket && <p className="message success" role="status">Ticket <strong>{createdTicket.id.slice(0, 8)}</strong> submitted. Helpdesk will review it shortly.</p>}

            <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Submitting...' : 'Submit ticket'}</button>
          </form>
        </section>

        <section className="tickets-card" aria-labelledby="tickets-title">
          <div className="card-heading">
            <h2 id="tickets-title">My tickets</h2>
            <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={isLoadingTickets} aria-label="Refresh submitted tickets" title="Refresh submitted tickets">↻</button>
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
                    <th>Project</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="mono">{ticket.id.slice(0, 8)}</td>
                      <td>
                        {ticket.title}
                        <AttachmentCount count={ticket.attachmentCount} />
                      </td>
                      <td>{TEAM_LABELS[ticket.teamId] ?? ticket.teamId}</td>
                      <td className="capitalize">{ticket.issueType}</td>
                      <td>{ticket.project}</td>
                      <td><span className={`status-pill status-${statusSlug(ticket.status)}`}>{displayStatus(ticket.status)}</span></td>
                      <td>{new Date(ticket.createdAt).toLocaleString()}</td>
                      <td>
                        <button
                          type="button"
                          className="review-button review-button-outline"
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
              {reviewTicket.priority && <div><dt>Priority</dt><dd className="capitalize">{reviewTicket.priority}</dd></div>}
            </dl>

            <div className="modal-description">
              <p className="eyebrow">YOUR REQUEST</p>
              <p>{reviewTicket.description}</p>
            </div>

            {reviewTicket.status === 'Rejected' && (
              <div className="modal-description">
                <p className="eyebrow">REJECTION REASON</p>
                <p>{reviewTicket.rejectionReason ?? 'No reason was provided.'}</p>
              </div>
            )}

            {reviewTicket.status !== 'Rejected' && (
              <div className="modal-description">
                <p className="eyebrow">ASSIGNMENT</p>
                {reviewTicket.status === 'Pending Helpdesk Review' ? (
                  <p>Awaiting Helpdesk review.</p>
                ) : reviewTicket.assigneeId ? (
                  <p>
                    Assigned to <strong>{reviewTicket.assigneeName ?? reviewTicket.assigneeId}</strong>
                    {reviewTicket.expectedDurationHours ? ` \u00b7 Expected duration: ${reviewTicket.expectedDurationHours}h` : ''}
                    {reviewTicket.assignedAt ? ` \u00b7 Assigned on ${new Date(reviewTicket.assignedAt).toLocaleString()}` : ''}
                  </p>
                ) : (
                  <p>Approved with priority <strong className="capitalize">{reviewTicket.priority ?? 'not set'}</strong>. Awaiting Helpdesk assignment.</p>
                )}
              </div>
            )}

            <TicketResolutionNote ticket={reviewTicket} />
            <TicketAttachments key={`${reviewTicket.id}-${attachmentsVersion}`} ticket={reviewTicket} />
            {reviewTicket.status !== 'Resolved' && reviewTicket.status !== 'Rejected' && (
              <RequesterAttachmentUpload ticketId={reviewTicket.id} onUploaded={() => {
                setAttachmentsVersion((version) => version + 1);
                void loadTickets();
              }} />
            )}
            <TicketComments ticket={reviewTicket} />
            <TicketHistory ticket={reviewTicket} />
          </div>
        </div>
      )}
    </div>
  );
}
// Lets the requester add files to an open ticket after submitting it.
function RequesterAttachmentUpload({ ticketId, onUploaded }: { ticketId: string; onUploaded: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload() {
    setError('');
    setIsUploading(true);
    try {
      await uploadAttachments(ticketId, files);
      setFiles([]);
      onUploaded();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The files could not be uploaded.');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="modal-attachment-upload">
      <AttachmentPicker files={files} onChange={setFiles} label="Add files to this ticket" disabled={isUploading} />
      {error && <p className="message error" role="alert">{error}</p>}
      {files.length > 0 && (
        <button type="button" className="review-button review-button-active" onClick={() => void handleUpload()} disabled={isUploading}>
          {isUploading ? 'Uploading...' : `Upload ${files.length} file${files.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
