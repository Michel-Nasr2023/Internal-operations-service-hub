import { useState } from 'react';
import { AuthUser, clearStoredUser, loginUser, saveStoredUser } from './api/auth';
import { CreateTicketPage } from './features/tickets/CreateTicketPage';
import { AssignedTicketsPage } from './features/tickets/AssignedTicketsPage';
import { HelpdeskDashboardPage } from './features/helpdesk/HelpdeskDashboardPage';
import { NotificationBell } from './features/notifications/NotificationBell';
import { SignUpPage } from './features/auth/SignUpPage';

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');
  const [employeeTab, setEmployeeTab] = useState<'requests' | 'tasks'>('requests');
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [form, setForm] = useState<LoginFormState>(initialForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    clearStoredUser();
    setUser(null);
    setAuthView('login');
    setIsLogoutModalOpen(false);
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
            <NotificationBell userId={user.id} role="helpdesk" onSelectTicket={(ticketId) => setPendingTicketId(ticketId)} />
            <span className="user-chip">{user.firstName} {user.lastName} · Helpdesk</span>
            <button type="button" className="logout-button" onClick={handleLogout}>Log out</button>
          </div>
        </header>

        <div className="employee-layout">
          <HelpdeskDashboardPage externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />
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
          <NotificationBell userId={user.id} role="employee" onSelectTicket={(ticketId) => { setEmployeeTab('requests'); setPendingTicketId(ticketId); }} />
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
          <CreateTicketPage externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />
        ) : (
          <AssignedTicketsPage userId={user.id} />
        )}
      </div>
      {logoutModal}
    </main>
  );
}