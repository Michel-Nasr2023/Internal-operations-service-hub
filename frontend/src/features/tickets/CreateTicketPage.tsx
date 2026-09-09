import { FormEvent, useEffect, useState } from 'react';
import { createTicket, CreateTicketInput, getMyTickets, Ticket } from '../../api/tickets';

const initialForm: CreateTicketInput = {
  title: '',
  description: '',
  teamId: 'it',
  issueType: 'hardware',
  project: 'internal',
};

export function CreateTicketPage() {
  const [form, setForm] = useState(initialForm);
  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(true);

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

  return (
    <main className="page-shell">
      <section className="intro">
        <p className="eyebrow">INTERNAL OPERATIONS HUB</p>
        <h1>Make the work visible.</h1>
        <p className="intro-copy">Tell the operations team what is blocked. Your request will be saved and tracked from the first submission.</p>
        <div className="flow-note">
          <span>01</span>
          <div>
            <strong>Submit a request</strong>
            <small>It will enter Helpdesk review.</small>
          </div>
        </div>
      </section>

      <section className="form-panel" aria-labelledby="form-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">NEW REQUEST</p>
            <h2 id="form-title">Create a ticket</h2>
          </div>
          <span className="status-dot">● Ready</span>
        </div>

        <form onSubmit={handleSubmit}>
          <label>
            What do you need help with?
            <input value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder="e.g. Laptop cannot connect to Wi-Fi" maxLength={150} required />
          </label>

          <label>
            Describe the issue
            <textarea value={form.description} onChange={(event) => updateField('description', event.target.value)} placeholder="Include what happened and what you have already tried." maxLength={5000} rows={5} required />
          </label>

          <div className="field-grid">
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
          </div>

          <label>
            Project or area
            <input value={form.project} onChange={(event) => updateField('project', event.target.value)} placeholder="e.g. Internal tools" required />
          </label>

          {error && <p className="message error" role="alert">{error}</p>}
          {createdTicket && <p className="message success" role="status">Ticket <strong>{createdTicket.id.slice(0, 8)}</strong> saved. Status: {createdTicket.status}.</p>}

          <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving request...' : 'Submit request'} <span aria-hidden="true">↗</span></button>
        </form>
      </section>

      <section className="tickets-panel" aria-labelledby="tickets-title">
        <div className="tickets-heading">
          <div>
            <p className="eyebrow">PERSISTED RECORDS</p>
            <h2 id="tickets-title">My submitted tickets</h2>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadTickets()} disabled={isLoadingTickets} aria-label="Refresh submitted tickets" title="Refresh submitted tickets">↻</button>
        </div>
        <p className="persistence-note"><span aria-hidden="true">●</span> Loaded from the backend database</p>
        {isLoadingTickets && <p className="empty-state">Loading saved tickets...</p>}
        {!isLoadingTickets && tickets.length === 0 && <p className="empty-state">No tickets submitted yet.</p>}
        {!isLoadingTickets && tickets.length > 0 && (
          <div className="ticket-list">
            {tickets.map((ticket) => (
              <article className="ticket-row" key={ticket.id}>
                <div>
                  <strong>{ticket.title}</strong>
                  <small>{ticket.id.slice(0, 8)} · {new Date(ticket.createdAt).toLocaleString()}</small>
                </div>
                <span className="ticket-status">{ticket.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}