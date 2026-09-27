import { useEffect, useState } from 'react';
import { DirectoryUser, listAssignableEmployees } from '../../api/auth';
import { getTickets, Ticket } from '../../api/tickets';
import { AssigneeWorkload, computeWorkload, HIGH_LOAD, isTicketOverdue, LOAD_LABELS, MODERATE_LOAD } from './workload';

type WorkloadSort = 'most' | 'least' | 'name';

function statusSlug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, '-');
}

function sortRows(rows: AssigneeWorkload[], order: WorkloadSort): AssigneeWorkload[] {
  const byName = (a: AssigneeWorkload, b: AssigneeWorkload) =>
    `${a.employee.firstName} ${a.employee.lastName}`.localeCompare(`${b.employee.firstName} ${b.employee.lastName}`);

  return [...rows].sort((a, b) => {
    if (order === 'name') return byName(a, b);
    const diff = order === 'most' ? b.active - a.active || b.overdue - a.overdue : a.active - b.active || a.overdue - b.overdue;
    return diff || byName(a, b);
  });
}

export function TeamWorkloadPage() {
  const [employees, setEmployees] = useState<DirectoryUser[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortOrder, setSortOrder] = useState<WorkloadSort>('most');
  const [searchTerm, setSearchTerm] = useState('');
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError('');

    try {
      const [loadedEmployees, loadedTickets] = await Promise.all([listAssignableEmployees(), getTickets()]);
      setEmployees(loadedEmployees);
      setTickets(loadedTickets);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Team workload could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const now = Date.now();
  const rows = computeWorkload(employees, tickets, now);
  const term = searchTerm.trim().toLowerCase();
  const visibleRows = sortRows(rows, sortOrder).filter(
    (row) => !term || `${row.employee.firstName} ${row.employee.lastName} ${row.employee.jobTitle ?? ''}`.toLowerCase().includes(term),
  );
  const highLoadCount = rows.filter((row) => row.level === 'high').length;
  const availableCount = rows.filter((row) => row.active === 0).length;
  const overdueTotal = rows.reduce((sum, row) => sum + row.overdue, 0);
  const detail = rows.find((row) => row.employee.id === detailEmployeeId) ?? null;

  return (
    <div className="service-desk">
      <section className="tickets-card" aria-labelledby="workload-title">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2 id="workload-title">Team workload</h2>
            <div className="queue-stats">
              <span><strong>{rows.length}</strong> assignees</span>
              <span><strong>{availableCount}</strong> with no active tickets</span>
              <span className={highLoadCount > 0 ? 'queue-stat-alert' : undefined}><strong>{highLoadCount}</strong> at high load</span>
              <span className={overdueTotal > 0 ? 'queue-stat-alert' : undefined}><strong>{overdueTotal}</strong> overdue</span>
            </div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void load()} disabled={isLoading} aria-label="Refresh team workload" title="Refresh team workload">↻</button>
        </div>

        <div className="filter-bar">
          <label>
            Sort
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as WorkloadSort)}>
              <option value="most">Most active first</option>
              <option value="least">Least active first</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label className="filter-search">
            Search
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by name or job title" />
          </label>
        </div>

        <p className="workload-legend">
          Active = assigned + in progress. <span className="load-pill load-moderate">Busy</span> at {MODERATE_LOAD}+ active,{' '}
          <span className="load-pill load-high">High load</span> at {HIGH_LOAD}+.
        </p>

        {error && <p className="message error" role="alert">{error}</p>}
        {isLoading && <p className="empty-state">Loading team workload...</p>}
        {!isLoading && rows.length === 0 && <p className="empty-state">There are no employees to assign tickets to yet.</p>}
        {!isLoading && rows.length > 0 && visibleRows.length === 0 && <p className="empty-state">No one matches the search.</p>}

        {!isLoading && visibleRows.length > 0 && (
          <div className="table-scroll">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>Assignee</th>
                  <th>Job title</th>
                  <th>Awaiting claim</th>
                  <th>In progress</th>
                  <th>Overdue</th>
                  <th>Active</th>
                  <th>Resolved (30 days)</th>
                  <th>Next due</th>
                  <th>Load</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.employee.id}>
                    <td>{row.employee.firstName} {row.employee.lastName}</td>
                    <td>{row.employee.jobTitle ?? '—'}</td>
                    <td>{row.awaitingClaim}</td>
                    <td>{row.inProgress}</td>
                    <td className={row.overdue > 0 ? 'workload-alert' : undefined}>{row.overdue}</td>
                    <td><strong>{row.active}</strong></td>
                    <td>{row.resolvedRecently}</td>
                    <td>{row.nextDueAt ? new Date(row.nextDueAt).toLocaleString() : '—'}</td>
                    <td><span className={`load-pill load-${row.level}`}>{LOAD_LABELS[row.level]}</span></td>
                    <td>
                      <button
                        type="button"
                        className="review-button review-button-outline"
                        disabled={row.active === 0}
                        onClick={() => setDetailEmployeeId(row.employee.id)}
                      >
                        Tickets
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="workload-detail-title" onClick={() => setDetailEmployeeId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">ACTIVE TICKETS · {detail.active}</p>
                <h2 id="workload-detail-title">{detail.employee.firstName} {detail.employee.lastName}</h2>
              </div>
              <button type="button" className="icon-button modal-close" aria-label="Close" onClick={() => setDetailEmployeeId(null)}>✕</button>
            </div>

            <ul className="workload-ticket-list">
              {detail.activeTickets.map((ticket) => (
                <li key={ticket.id}>
                  <div>
                    <strong>{ticket.title}</strong>
                    <small>
                      <span className="mono">{ticket.id.slice(0, 8)}</span>
                      {' · '}
                      <span className="capitalize">{ticket.priority ?? 'no'} priority</span>
                      {ticket.dueAt ? ` · Due ${new Date(ticket.dueAt).toLocaleString()}` : ` · Assigned ${ticket.assignedAt ? new Date(ticket.assignedAt).toLocaleString() : ''}`}
                    </small>
                  </div>
                  <div className="workload-ticket-status">
                    <span className={`status-pill status-${statusSlug(ticket.status)}`}>{ticket.status}</span>
                    {isTicketOverdue(ticket, now) && <span className="status-pill status-rejected">Overdue</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
