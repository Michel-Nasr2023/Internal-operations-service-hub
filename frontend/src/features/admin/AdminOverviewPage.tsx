import { useEffect, useState } from 'react';
import { AdminOverview, getAdminOverview } from '../../api/admin';

const STATUS_ORDER = ['Pending Helpdesk Review', 'Approved', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];
const STATUS_LABELS: Record<string, string> = { 'Pending Helpdesk Review': 'Pending' };

interface AdminOverviewPageProps {
  onOpenTab: (tab: 'users' | 'queue' | 'activity' | 'system') => void;
}

export function AdminOverviewPage({ onOpenTab }: AdminOverviewPageProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    setError('');
    try {
      setOverview(await getAdminOverview());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The overview could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const statusMax = overview ? Math.max(1, ...Object.values(overview.tickets.byStatus)) : 1;

  return (
    <div className="service-desk admin-page">
      <section className="tickets-card">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2>Overview</h2>
            <div className="queue-stats"><span>The state of the service hub at a glance.</span></div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void load()} disabled={isLoading} aria-label="Refresh overview" title="Refresh overview">↻</button>
        </div>

        {error && <p className="message error" role="alert">{error}</p>}
        {!overview && isLoading && <p className="empty-state">Loading overview...</p>}

        {overview && (
          <div className="admin-overview-scroll">
            <div className="stat-grid">
              <button type="button" className="stat-tile" onClick={() => onOpenTab('queue')}>
                <span>Open tickets</span>
                <strong>{overview.tickets.open}</strong>
                <small>{overview.tickets.total} in total</small>
              </button>
              <button type="button" className={overview.tickets.overdue > 0 ? 'stat-tile stat-tile-alert' : 'stat-tile'} onClick={() => onOpenTab('queue')}>
                <span>Overdue</span>
                <strong>{overview.tickets.overdue}</strong>
                <small>in progress past their due time</small>
              </button>
              <button type="button" className={overview.tickets.unassignedApproved > 0 ? 'stat-tile stat-tile-warn' : 'stat-tile'} onClick={() => onOpenTab('queue')}>
                <span>Approved, unassigned</span>
                <strong>{overview.tickets.unassignedApproved}</strong>
                <small>waiting for an assignee</small>
              </button>
              <button type="button" className="stat-tile" onClick={() => onOpenTab('users')}>
                <span>Active users</span>
                <strong>{overview.users.active}</strong>
                <small>{overview.users.disabled} disabled</small>
              </button>
              <button type="button" className={overview.security.failedSignIns24h > 0 ? 'stat-tile stat-tile-warn' : 'stat-tile'} onClick={() => onOpenTab('activity')}>
                <span>Failed sign-ins</span>
                <strong>{overview.security.failedSignIns24h}</strong>
                <small>in the last 24 hours</small>
              </button>
              <button type="button" className={overview.tickets.aiFailed > 0 ? 'stat-tile stat-tile-warn' : 'stat-tile'} onClick={() => onOpenTab('system')}>
                <span>AI analysis</span>
                <strong>{overview.tickets.aiFailed}</strong>
                <small>failed · {overview.tickets.aiPending} in progress</small>
              </button>
            </div>

            <div className="admin-columns">
              <section className="admin-panel" aria-labelledby="status-breakdown">
                <h3 id="status-breakdown">Tickets by status</h3>
                <ul className="bar-list">
                  {STATUS_ORDER.map((status) => {
                    const count = overview.tickets.byStatus[status] ?? 0;
                    return (
                      <li key={status}>
                        <span>{STATUS_LABELS[status] ?? status}</span>
                        <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ width: `${(count / statusMax) * 100}%` }} /></span>
                        <strong>{count}</strong>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="admin-panel" aria-labelledby="role-breakdown">
                <h3 id="role-breakdown">People by role</h3>
                <ul className="bar-list">
                  {(['employee', 'helpdesk', 'administrator'] as const).map((role) => {
                    const count = overview.users.byRole[role] ?? 0;
                    return (
                      <li key={role}>
                        <span className="capitalize">{role}</span>
                        <span className="bar-track" aria-hidden="true"><span className="bar-fill bar-fill-neutral" style={{ width: `${(count / Math.max(1, overview.users.total)) * 100}%` }} /></span>
                        <strong>{count}</strong>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            <section className="admin-panel" aria-labelledby="security-events">
              <div className="admin-panel-heading">
                <h3 id="security-events">Recent security events</h3>
                <button type="button" className="link-button" onClick={() => onOpenTab('activity')}>Open activity log</button>
              </div>
              {overview.security.recent.length === 0 ? (
                <p className="empty-state">No failed sign-ins or refused requests recorded.</p>
              ) : (
                <ul className="security-list">
                  {overview.security.recent.map((entry) => (
                    <li key={entry.id}>
                      <span className={`status-pill ${entry.outcome === 'denied' ? 'status-rejected' : 'status-pending-helpdesk-review'}`}>{entry.outcome}</span>
                      <span className="security-summary">{entry.summary}</span>
                      <small>{new Date(entry.timestamp).toLocaleString()}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
