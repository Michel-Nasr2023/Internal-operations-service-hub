import { useEffect, useState } from 'react';
import { AuthUser, clearStoredUser, loadStoredUser, loginUser, logoutUser, saveStoredUser, SESSION_EXPIRED_EVENT } from './api/auth';
import { CreateTicketPage } from './features/tickets/CreateTicketPage';
import { AssignedTicketsPage } from './features/tickets/AssignedTicketsPage';
import { HelpdeskDashboardPage } from './features/helpdesk/HelpdeskDashboardPage';
import { TeamWorkloadPage } from './features/helpdesk/TeamWorkloadPage';
import { ActivityLogPage } from './features/helpdesk/ActivityLogPage';
import { NotificationBell } from './features/notifications/NotificationBell';
import { SignUpPage } from './features/auth/SignUpPage';
import { getMyTickets } from './api/tickets';
import { NotificationKind } from './api/notifications';

interface LoginFormState {
  email: string;
  password: string;
}

const ORGANIZATION_NAME = 'Internal Operations Service Hub';

const initialForm: LoginFormState = {
  email: 'employee@company.com',
  password: 'employee123',
};

export function App() {
  const [user, setUser] = useState<AuthUser | null>(() => loadStoredUser());
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');
  const [employeeTab, setEmployeeTab] = useState<'requests' | 'tasks'>('requests');
  const [helpdeskTab, setHelpdeskTab] = useState<'queue' | 'workload' | 'activity'>('queue');
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [form, setForm] = useState<LoginFormState>(initialForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function handleSessionExpired() {
      setUser(null);
      setAuthView('login');
      setIsLogoutModalOpen(false);
      setError('Your session has expired. Please sign in again.');
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const loggedInUser = await loginUser(form);
      saveStoredUser(loggedInUser);
      setUser(loggedInUser);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogout() {
    setIsLogoutModalOpen(true);
  }

  function confirmLogout() {
    // Sent before the session is cleared so the sign-out is attributed to this user in the audit log.
    void logoutUser();
    clearStoredUser();
    setUser(null);
    setAuthView('login');
    setIsLogoutModalOpen(false);
  }

  // Assignment notifications, and comments on tickets assigned to this employee, open My tasks;
  // everything else opens the ticket in My tickets.
  async function openEmployeeTicket(ticketId: string, kind: NotificationKind) {
    let tab: 'requests' | 'tasks' = kind === 'ticket-assigned' ? 'tasks' : 'requests';
    if (kind === 'ticket-comment' && user) {
      const ticket = (await getMyTickets().catch(() => [])).find((item) => item.id === ticketId);
      if (ticket && ticket.requesterId !== user.id && ticket.assigneeId === user.id) tab = 'tasks';
    }
    setEmployeeTab(tab);
    setPendingTicketId(ticketId);
  }

  function handleSignedUp(signedUpUser: AuthUser) {
    saveStoredUser(signedUpUser);
    setUser(signedUpUser);
    setAuthView('login');
  }

  const logoutModal = isLogoutModalOpen && (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="logout-modal-title" onClick={() => setIsLogoutModalOpen(false)}>
      <div className="logout-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="logout-modal-icon" aria-hidden="true">↗</div>
        <p className="eyebrow">END SESSION</p>
        <h2 id="logout-modal-title">Ready to leave?</h2>
        <p className="logout-modal-copy">You are about to sign out of the Internal Operations Service Hub. Any unsaved work will be lost.</p>
        <div className="logout-modal-actions">
          <button type="button" className="logout-cancel-button" onClick={() => setIsLogoutModalOpen(false)}>Stay signed in</button>
          <button type="button" className="logout-confirm-button" onClick={confirmLogout}>Log out</button>
        </div>
      </div>
    </div>
  );

  if (!user && authView === 'signup') {
    return <SignUpPage onSignedUp={handleSignedUp} onBackToLogin={() => setAuthView('login')} />;
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand">
            <span className="brand-mark">OPS</span>
            <span className="brand-name">{ORGANIZATION_NAME}</span>
          </div>
          <p className="eyebrow">SERVICE DESK</p>
          <h1>Sign in</h1>
          <p className="auth-copy">Sign in with your company account to submit a ticket or manage the Helpdesk queue.</p>

          <form onSubmit={handleLogin} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="employee@company.com"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Enter password"
                required
              />
            </label>

            {error && <p className="message error" role="alert">{error}</p>}

            <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Sign in'}</button>
          </form>

          <div className="login-credentials">
            <p className="credentials-title">Development accounts</p>
            <p><strong>Employee</strong><br />employee@company.com<br />employee123</p>
            <p><strong>Helpdesk</strong><br />helpdesk@company.com<br />helpdesk123</p>
          </div>

          <p className="auth-switch">
            Need an account? <button type="button" className="link-button" onClick={() => setAuthView('signup')}>Sign up</button>
          </p>
        </section>
      </main>
    );
  }

  if (user.role === 'helpdesk') {
    return (
      <main className="dashboard-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">OPS</span>
            <div>
              <span className="brand-name">{ORGANIZATION_NAME}</span>
              <p className="eyebrow">HELPDESK QUEUE</p>
            </div>
          </div>
          <div className="topbar-actions">
            <NotificationBell onSelectTicket={(ticketId) => { setHelpdeskTab('queue'); setPendingTicketId(ticketId); }} />
            <span className="user-chip">{user.firstName} {user.lastName} · Helpdesk</span>
            <button type="button" className="logout-button" onClick={handleLogout}>Log out</button>
          </div>
        </header>

        <nav className="tab-switch">
          <button type="button" className={helpdeskTab === 'queue' ? 'tab-button tab-button-active' : 'tab-button'} onClick={() => setHelpdeskTab('queue')}>Tickets queue</button>
          <button type="button" className={helpdeskTab === 'workload' ? 'tab-button tab-button-active' : 'tab-button'} onClick={() => setHelpdeskTab('workload')}>Team workload</button>
          <button type="button" className={helpdeskTab === 'activity' ? 'tab-button tab-button-active' : 'tab-button'} onClick={() => setHelpdeskTab('activity')}>Activity log</button>
        </nav>

        <div className="employee-layout">
          {helpdeskTab === 'queue' ? (
            <HelpdeskDashboardPage externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />
          ) : helpdeskTab === 'workload' ? (
            <TeamWorkloadPage />
          ) : (
            <ActivityLogPage />
          )}
        </div>
        {logoutModal}
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">OPS</span>
          <div>
            <span className="brand-name">{ORGANIZATION_NAME}</span>
            <p className="eyebrow">SERVICE DESK</p>
          </div>
        </div>
        <div className="topbar-actions">
          <NotificationBell onSelectTicket={(ticketId, kind) => void openEmployeeTicket(ticketId, kind)} />
          <span className="user-chip">{user.firstName} {user.lastName} · {user.jobTitle ?? 'Employee'}</span>
          <button type="button" className="logout-button" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <nav className="tab-switch">
        <button type="button" className={employeeTab === 'requests' ? 'tab-button tab-button-active' : 'tab-button'} onClick={() => setEmployeeTab('requests')}>New request</button>
        <button type="button" className={employeeTab === 'tasks' ? 'tab-button tab-button-active' : 'tab-button'} onClick={() => setEmployeeTab('tasks')}>My tasks</button>
      </nav>

      <div className="employee-layout">
        {employeeTab === 'requests' ? (
          <CreateTicketPage userId={user.id} externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />
        ) : (
          <AssignedTicketsPage userId={user.id} externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />
        )}
      </div>
      {logoutModal}
    </main>
  );
}