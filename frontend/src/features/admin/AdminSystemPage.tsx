import { useEffect, useState } from 'react';
import { getEmailOutbox, getSystemStatus, OutboxEmail, SystemStatus } from '../../api/admin';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(' ');
}

const PURPOSE_LABELS: Record<string, string> = { 'password-reset': 'Password reset', 'account-invite': 'Invitation' };
const DELIVERY_LABELS: Record<string, string> = { sent: 'Sent', retrying: 'Retrying', failed: 'Failed', 'not-configured': 'Not sent' };
const DELIVERY_CLASSES: Record<string, string> = {
  sent: 'status-resolved',
  retrying: 'status-assigned',
  failed: 'status-rejected',
  'not-configured': 'status-pending-helpdesk-review',
};

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
        {
          label: 'Email delivery',
          ok: status.email.mode !== 'outbox-only' ? status.email.connection === 'ok' || (status.email.connection === 'unchecked' && !status.email.lastFailure) : false,
          detail:
            status.email.mode === 'outbox-only'
              ? 'No mail server configured (SMTP_HOST): emails are kept in the outbox below and not delivered'
              : status.email.connection === 'failed'
                ? `Cannot use ${status.email.host}: ${status.email.connectionError ?? 'connection failed'}`
                : `Sending through ${status.email.host} as ${status.email.from}${status.email.lastSentAt ? ` · last sent ${new Date(status.email.lastSentAt).toLocaleString()}` : ''}${
                    status.email.lastFailure ? ` · last failure: ${status.email.lastFailure.error}` : ''
                  }`,
        },
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
                Every email the system sends (password resets, invitations) and whether it was delivered. If the mail server is briefly unreachable, the email
                is sent again automatically (up to 3 attempts). When no mail server is configured, this is also where the emails can be read. Treat them as
                confidential: each contains a working reset link or code.
              </p>
              {outbox.length === 0 ? (
                <p className="empty-state">No emails sent yet.</p>
              ) : (
                <ul className="outbox-list">
                  {outbox.map((email) => (
                    <li key={email.id}>
                      <button type="button" className="outbox-item" aria-expanded={openEmailId === email.id} onClick={() => setOpenEmailId(openEmailId === email.id ? null : email.id)}>
                        <span className="outbox-tags">
                          <span className="status-pill status-assigned">{PURPOSE_LABELS[email.purpose] ?? email.purpose}</span>
                          <span className={`status-pill ${DELIVERY_CLASSES[email.status] ?? 'status-assigned'}`}>{DELIVERY_LABELS[email.status] ?? email.status}</span>
                        </span>
                        <span className="outbox-subject">
                          <strong>{email.to}</strong>
                          <small>{email.subject}</small>
                        </span>
                        <small className="nowrap">{new Date(email.createdAt).toLocaleString()}</small>
                      </button>
                      {openEmail?.id === email.id && (
                        <>
                          {email.error && (
                            <p className="message error">
                              {email.status === 'retrying' ? 'Temporary problem' : 'Delivery failed'}
                              {email.attempts && email.attempts > 1 ? ` after ${email.attempts} attempts` : ''}: {email.error}
                              {email.status === 'retrying' && email.nextAttemptAt && (
                                <> · trying again automatically at {new Date(email.nextAttemptAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                              )}
                            </p>
                          )}
                          <pre className="outbox-body">{email.body}</pre>
                        </>
                      )}
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
