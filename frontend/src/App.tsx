import { useCallback, useEffect, useState } from 'react';
import { AuthShowcase } from './features/auth/AuthShowcase';
import { AuthUser, clearStoredUser, loadStoredUser, loginUser, logoutUser, saveStoredUser, SESSION_EXPIRED_EVENT } from './api/auth';
import { CreateTicketPage } from './features/tickets/CreateTicketPage';
import { AssignedTicketsPage } from './features/tickets/AssignedTicketsPage';
import { HelpdeskDashboardPage } from './features/helpdesk/HelpdeskDashboardPage';
import { TeamWorkloadPage } from './features/helpdesk/TeamWorkloadPage';
import { ActivityLogPage } from './features/helpdesk/ActivityLogPage';
import { NotificationBell } from './features/notifications/NotificationBell';
import { SignUpPage } from './features/auth/SignUpPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { PasswordInput } from './features/auth/PasswordInput';
import { AdminOverviewPage } from './features/admin/AdminOverviewPage';
import { AdminUsersPage } from './features/admin/AdminUsersPage';
import { AdminSystemPage } from './features/admin/AdminSystemPage';
import { ProfileMenu, SettingsTab } from './features/profile/ProfileMenu';
import { Greeting } from './features/profile/Greeting';
import { ProfileSettingsModal } from './features/profile/ProfileSettingsModal';
import { getProfile } from './api/profile';
import { getMyTickets } from './api/tickets';
import { NotificationKind } from './api/notifications';

interface LoginFormState {
  email: string;
  password: string;
}

type AuthView = 'login' | 'signup' | 'forgot' | 'reset';
type StaffTab = 'overview' | 'queue' | 'workload' | 'users' | 'activity' | 'system';

const ORGANIZATION_NAME = 'Internal Operations Service Hub';

const initialForm: LoginFormState = {
  email: 'employee@company.com',
  password: 'employee123',
};

// Password reset and invitation emails link to `/?reset=<token>`.
function readResetToken(): string | null {
  return new URLSearchParams(window.location.search).get('reset');
}

function clearResetToken(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('reset');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

const HELPDESK_TABS: Array<{ id: StaffTab; label: string }> = [
  { id: 'queue', label: 'Tickets queue' },
  { id: 'workload', label: 'Team workload' },
  { id: 'activity', label: 'Activity log' },
];

const ADMIN_TABS: Array<{ id: StaffTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'queue', label: 'Tickets queue' },
  { id: 'workload', label: 'Team workload' },
  { id: 'users', label: 'Users' },
  { id: 'activity', label: 'Activity log' },
  { id: 'system', label: 'System' },
];

export function App() {
  const [resetToken, setResetToken] = useState<string | null>(() => readResetToken());
  const [user, setUser] = useState<AuthUser | null>(() => (readResetToken() ? null : loadStoredUser()));
  const [authView, setAuthView] = useState<AuthView>(() => (readResetToken() ? 'reset' : 'login'));
  const [employeeTab, setEmployeeTab] = useState<'requests' | 'tasks'>('requests');
  const [staffTab, setStaffTab] = useState<StaffTab>(() => (loadStoredUser()?.role === 'administrator' ? 'overview' : 'queue'));
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [form, setForm] = useState<LoginFormState>(initialForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function handleSessionExpired(event: Event) {
      const reason = (event as CustomEvent<string | undefined>).detail;
      setUser(null);
      setAuthView('login');
      setIsLogoutModalOpen(false);
      setSettingsTab(null);
      setError(reason && reason !== 'A valid sign-in session is required' ? reason : 'Your session has expired. Please sign in again.');
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  function signIn(signedIn: AuthUser) {
    saveStoredUser(signedIn);
    setUser(signedIn);
    setStaffTab(signedIn.role === 'administrator' ? 'overview' : 'queue');
    setEmployeeTab('requests');
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      signIn(await loginUser(form));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogout() {
    setIsLogoutModalOpen(true);
  }

  // Profile changes update the top bar straight away and the stored session, so they survive a refresh.
  const handleUserUpdated = useCallback((changes: Partial<AuthUser>) => {
    setUser((current) => {
      if (!current) return current;
      const updated = { ...current, ...changes };
      saveStoredUser(updated);
      return updated;
    });
  }, []);

  // Once per sign-in, pick up profile changes made elsewhere (e.g. a new photo uploaded on another device).
  const signedInUserId = user?.id;
  useEffect(() => {
    if (!signedInUserId) return;
    getProfile()
      .then((profile) =>
        handleUserUpdated({ firstName: profile.firstName, lastName: profile.lastName, jobTitle: profile.jobTitle, avatarUpdatedAt: profile.avatarUpdatedAt }),
      )
      .catch(() => undefined);
  }, [signedInUserId, handleUserUpdated]);

  function confirmLogout() {
    setSettingsTab(null);
    // Sent before the session is cleared so the sign-out is attributed to this user in the audit log.
    void logoutUser();
    clearStoredUser();
    setUser(null);
    setAuthView('login');
    setIsLogoutModalOpen(false);
  }

  function leaveResetFlow(nextView: AuthView) {
    clearResetToken();
    setResetToken(null);
    setAuthView(nextView);
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

  const settingsModal = user && settingsTab && (
    <ProfileSettingsModal user={user} initialTab={settingsTab} onClose={() => setSettingsTab(null)} onUserUpdated={handleUserUpdated} />
  );

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

  if (!user && authView === 'reset' && resetToken) {
    return <ResetPasswordPage token={resetToken} onDone={() => leaveResetFlow('login')} onRequestNewLink={() => leaveResetFlow('forgot')} />;
  }

  if (!user && authView === 'forgot') {
    return (
      <ForgotPasswordPage
        initialEmail={form.email}
        onBackToLogin={(email) => {
          if (email) setForm({ email, password: '' });
          setError('');
          setAuthView('login');
        }}
      />
    );
  }

  if (!user && authView === 'signup') {
    return <SignUpPage onSignedUp={(signedUp) => { signIn(signedUp); setAuthView('login'); }} onBackToLogin={() => setAuthView('login')} />;
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <AuthShowcase />
        <section className="auth-card">
          <div className="brand">
            <span className="brand-mark">OPS</span>
            <span className="brand-name">{ORGANIZATION_NAME}</span>
          </div>
          <p className="eyebrow">SERVICE DESK</p>
          <h1>Sign in</h1>

          <form onSubmit={handleLogin} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="employee@company.com"
                autoComplete="email"
                required
              />
            </label>

            <label>
              <span className="label-row">
                Password
                <button type="button" className="link-button forgot-link" onClick={() => { setError(''); setAuthView('forgot'); }}>Forgot password?</button>
              </span>
              <PasswordInput
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
            </label>

            {error && <p className="message error" role="alert">{error}</p>}

            <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Sign in'}</button>
          </form>

          <div className="login-credentials">
            <p className="credentials-title">Development accounts</p>
            <p className="credential-row"><strong>Employee</strong><span>employee@company.com</span><code>employee123</code></p>
            <p className="credential-row"><strong>Helpdesk</strong><span>helpdesk@company.com</span><code>helpdesk123</code></p>
            <p className="credential-row"><strong>Administrator</strong><span>admin@company.com</span><code>Admin12345</code></p>
          </div>

          <p className="auth-switch">
            Need an account? <button type="button" className="link-button" onClick={() => setAuthView('signup')}>Sign up</button>
          </p>
        </section>
      </main>
    );
  }

  if (user.role === 'helpdesk' || user.role === 'administrator') {
    const isAdmin = user.role === 'administrator';
    const tabs = isAdmin ? ADMIN_TABS : HELPDESK_TABS;
    const activeTab = tabs.some((tab) => tab.id === staffTab) ? staffTab : tabs[0].id;

    return (
      <main className="dashboard-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">OPS</span>
            <div>
              <span className="brand-name">{ORGANIZATION_NAME}</span>
              <p className="eyebrow">{isAdmin ? 'ADMINISTRATION' : 'HELPDESK QUEUE'}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <NotificationBell onSelectTicket={(ticketId) => { setStaffTab('queue'); setPendingTicketId(ticketId); }} />
            <ProfileMenu user={user} onOpenSettings={setSettingsTab} onLogout={handleLogout} />
          </div>
        </header>

        <nav className="tab-switch" aria-label="Sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'tab-button tab-button-active' : 'tab-button'}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onClick={() => setStaffTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <Greeting firstName={user.firstName} />
        </nav>

        <div className="employee-layout">
          {activeTab === 'overview' && <AdminOverviewPage onOpenTab={setStaffTab} />}
          {activeTab === 'queue' && <HelpdeskDashboardPage currentUserId={user.id} externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />}
          {activeTab === 'workload' && <TeamWorkloadPage />}
          {activeTab === 'users' && <AdminUsersPage currentUserId={user.id} />}
          {activeTab === 'activity' && <ActivityLogPage />}
          {activeTab === 'system' && <AdminSystemPage />}
        </div>
        {settingsModal}
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
          <ProfileMenu user={user} onOpenSettings={setSettingsTab} onLogout={handleLogout} />
        </div>
      </header>

      <nav className="tab-switch">
        <button type="button" className={employeeTab === 'requests' ? 'tab-button tab-button-active' : 'tab-button'} onClick={() => setEmployeeTab('requests')}>New request</button>
        <button type="button" className={employeeTab === 'tasks' ? 'tab-button tab-button-active' : 'tab-button'} onClick={() => setEmployeeTab('tasks')}>My tasks</button>
        <Greeting firstName={user.firstName} />
      </nav>

      <div className="employee-layout">
        {employeeTab === 'requests' ? (
          <CreateTicketPage userId={user.id} externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />
        ) : (
          <AssignedTicketsPage userId={user.id} externalOpenTicketId={pendingTicketId} onExternalOpenHandled={() => setPendingTicketId(null)} />
        )}
      </div>
      {settingsModal}
      {logoutModal}
    </main>
  );
}
