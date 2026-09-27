import { useEffect, useState } from 'react';
import { AuditCategory, AuditLogEntry, AuditOutcome, getAuditLog } from '../../api/audit';

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  auth: 'Sign-in',
  ticket: 'Ticket',
  access: 'Access',
};

const OUTCOME_CLASSES: Record<AuditOutcome, string> = {
  success: 'status-resolved',
  failure: 'status-pending-helpdesk-review',
  denied: 'status-rejected',
};

function actorLabel(entry: AuditLogEntry): string {
  if (entry.actorName) return entry.actorName;
  if (entry.actorId) return entry.actorId;
  const email = entry.details?.email;
  return typeof email === 'string' ? `${email} (not signed in)` : 'Not signed in';
}

export function ActivityLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [outcome, setOutcome] = useState<AuditOutcome | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load(append = false) {
    setIsLoading(true);
    setError('');

    try {
      const page = await getAuditLog({
        category: category || undefined,
        outcome: outcome || undefined,
        search: search || undefined,
        before: append ? nextBefore : undefined,
      });
      setEntries((current) => (append ? [...current, ...page.items] : page.items));
      setNextBefore(page.nextBefore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The activity log could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, outcome, search]);

  // Search runs shortly after typing stops rather than on every keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const detail = entries.find((entry) => entry.id === detailId) ?? null;

  return (
    <div className="service-desk">
      <section className="tickets-card" aria-labelledby="activity-title">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2 id="activity-title">Activity log</h2>
            <div className="queue-stats">
              <span>Every sign-in, refused request and ticket action, newest first.</span>
            </div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void load()} disabled={isLoading} aria-label="Refresh activity log" title="Refresh activity log">↻</button>
        </div>

        <div className="filter-bar">
          <label>
            Type
            <select value={category} onChange={(event) => setCategory(event.target.value as AuditCategory | '')}>
              <option value="">All types</option>
              <option value="ticket">Ticket actions</option>
              <option value="auth">Sign-in and accounts</option>
              <option value="access">Refused access</option>
            </select>
          </label>
          <label>
            Outcome
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as AuditOutcome | '')}>
              <option value="">All outcomes</option>
              <option value="success">Succeeded</option>
              <option value="failure">Failed</option>
              <option value="denied">Denied</option>
            </select>
          </label>
          <label className="filter-search">
            Search
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by summary, action, email, or ticket ID" />
          </label>
        </div>

        {error && <p className="message error" role="alert">{error}</p>}
        {!isLoading && entries.length === 0 && !error && <p className="empty-state">No activity matches these filters.</p>}

        {entries.length > 0 && (
          <div className="table-scroll">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Who</th>
                  <th>What happened</th>
                  <th>Outcome</th>
                  <th>IP address</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                    <td>{CATEGORY_LABELS[entry.category] ?? entry.category}</td>
                    <td>
                      {actorLabel(entry)}
                      {entry.actorRole && <small className="cell-subtext capitalize">{entry.actorRole}</small>}
                    </td>
                    <td className="description-cell activity-summary" title={entry.summary}>{entry.summary}</td>
                    <td><span className={`status-pill ${OUTCOME_CLASSES[entry.outcome]}`}>{entry.outcome}</span></td>
                    <td className="mono">{entry.ip ?? '—'}</td>
                    <td>
                      <button type="button" className="review-button review-button-outline" onClick={() => setDetailId(entry.id)}>Details</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isLoading && <p className="empty-state">Loading activity...</p>}
        {!isLoading && nextBefore && (
          <button type="button" className="load-more-button" onClick={() => void load(true)}>Load older activity</button>
        )}
      </section>

      {detail && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title" onClick={() => setDetailId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{CATEGORY_LABELS[detail.category]} · {detail.action}</p>
                <h2 id="activity-detail-title">{detail.summary}</h2>
              </div>
              <button type="button" className="icon-button modal-close" aria-label="Close" onClick={() => setDetailId(null)}>✕</button>
            </div>

            <dl className="modal-meta">
              <div><dt>Time</dt><dd>{new Date(detail.timestamp).toLocaleString()}</dd></div>
              <div><dt>Who</dt><dd>{actorLabel(detail)}{detail.actorRole ? ` · ${detail.actorRole}` : ''}</dd></div>
              <div><dt>Outcome</dt><dd><span className={`status-pill ${OUTCOME_CLASSES[detail.outcome]}`}>{detail.outcome}</span></dd></div>
              {detail.targetId && <div><dt>{detail.targetType === 'ticket' ? 'Ticket' : 'User'}</dt><dd className="mono">{detail.targetType === 'ticket' ? detail.targetId.slice(0, 8) : detail.targetId}</dd></div>}
              <div><dt>IP address</dt><dd className="mono">{detail.ip ?? '—'}</dd></div>
              <div><dt>Request ID</dt><dd className="mono">{detail.requestId ? detail.requestId.slice(0, 8) : '—'}</dd></div>
            </dl>

            {detail.userAgent && (
              <div className="modal-description">
                <p className="eyebrow">BROWSER</p>
                <p className="mono activity-user-agent">{detail.userAgent}</p>
              </div>
            )}

            {detail.details && Object.keys(detail.details).length > 0 && (
              <div className="modal-description">
                <p className="eyebrow">DETAILS</p>
                <dl className="modal-meta">
                  {Object.entries(detail.details).map(([key, value]) => (
                    <div key={key}><dt>{key}</dt><dd>{value === null ? '—' : String(value)}</dd></div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
