import { useEffect, useState } from 'react';
import { getEmailOutbox, getSystemStatus, OutboxEmail, SystemStatus } from '../../api/admin';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(' ');
}

const PURPOSE_LABELS: Record<string, string> = { 'password-reset': 'Password reset', 'account-invite': 'Invitation' };

export function AdminSystemPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [outbox, setOutbox] = useState<OutboxEmail[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError('');
    try {
      const [loadedStatus, loadedOutbox] = await Promise.all([getSystemStatus(), getEmailOutbox()]);
      setStatus(loadedStatus);
      setOutbox(loadedOutbox);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'System status could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const checks = status
    ? [
        { label: 'Database', ok: status.database.ok, detail: `Responding in ${status.database.responseMs} ms` },
        {
          label: 'AI analysis',
          ok: status.ai.configured,
          detail: status.ai.configured ? `${status.ai.model} · ${status.ai.pending} in progress · ${status.ai.failed} failed` : 'Not configured: RQSTY_API_KEY is missing, so every analysis fails',
        },
        {
          label: 'Session signing key',
          ok: status.authSecretConfigured,
          detail: status.authSecretConfigured ? 'AUTH_SECRET is set' : 'AUTH_SECRET is missing: everyone is signed out whenever the server restarts',
        },
        { label: 'Email delivery', ok: null, detail: status.email.delivery },
        { label: 'Server', ok: true, detail: `Up for ${formatUptime(status.uptimeSeconds)} · Node ${status.nodeVersion} · alerts checked every ${Math.round(status.notificationCheckIntervalMs / 60000)} min` },
      ]
    : [];
  const openEmail = outbox.find((email) => email.id === openEmailId) ?? null;

  return (
    <div className="service-desk admin-page">
      <section className="tickets-card">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2>System</h2>
            <div className="queue-stats"><span>Health checks and outgoing email.</span></div>
          </div>
          <button className="refresh-button" type="button" onClick={() => void load()} disabled={isLoading} aria-label="Refresh system status" title="Refresh system status">↻</button>
        </div>

        {error && <p className="message error" role="alert">{error}</p>}
        {!status && isLoading && <p className="empty-state">Checking the system...</p>}

        {status && (
          <div className="admin-overview-scroll">
            <section className="admin-panel" aria-labelledby="health-heading">
              <h3 id="health-heading">Health</h3>
              <ul className="health-list">
                {checks.map((check) => (
                  <li key={check.label}>
                    <span className={check.ok === null ? 'health-dot health-dot-info' : check.ok ? 'health-dot health-dot-ok' : 'health-dot health-dot-bad'} aria-hidden="true" />
                    <div>
                      <strong>{check.label}</strong>
                      <small>{check.detail}</small>
                    </div>
                    <span className={`status-pill ${check.ok === null ? 'status-assigned' : check.ok ? 'status-resolved' : 'status-rejected'}`}>
                      {check.ok === null ? 'Info' : check.ok ? 'OK' : 'Action needed'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="admin-panel" aria-labelledby="outbox-heading">
              <h3 id="outbox-heading">Email outbox</h3>
              <p className="settings-hint">
                No mail provider is connected yet, so emails the system sends (password resets, invitations) are kept here and printed in the server console.
                Treat them as confidential: each contains a working sign-in link.
              </p>
              {outbox.length === 0 ? (
                <p className="empty-state">No emails sent yet.</p>
              ) : (
                <ul className="outbox-list">
                  {outbox.map((email) => (
                    <li key={email.id}>
                      <button type="button" className="outbox-item" aria-expanded={openEmailId === email.id} onClick={() => setOpenEmailId(openEmailId === email.id ? null : email.id)}>
                        <span className="status-pill status-assigned">{PURPOSE_LABELS[email.purpose] ?? email.purpose}</span>
                        <span className="outbox-subject">
                          <strong>{email.to}</strong>
                          <small>{email.subject}</small>
                        </span>
                        <small className="nowrap">{new Date(email.createdAt).toLocaleString()}</small>
                      </button>
                      {openEmail?.id === email.id && <pre className="outbox-body">{email.body}</pre>}
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
