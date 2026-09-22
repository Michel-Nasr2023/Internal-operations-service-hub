import { useEffect, useState } from 'react';
import { AuthUser, clearStoredUser, loadStoredUser, loginUser, saveStoredUser } from './api/auth';
import { CreateTicketPage } from './features/tickets/CreateTicketPage';

interface LoginFormState {
  email: string;
  password: string;
}

const initialForm: LoginFormState = {
  email: 'employee@company.com',
  password: 'employee123',
};

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [form, setForm] = useState<LoginFormState>(initialForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const storedUser = loadStoredUser();
    if (storedUser) {
      setUser(storedUser);
    }
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
    clearStoredUser();
    setUser(null);
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">INTERNAL OPERATIONS HUB</p>
          <h1>Sign in</h1>
          <p className="auth-copy">Access the employee request workflow or the Helpdesk operations view.</p>

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

          <div className="demo-credentials">
            <strong>Demo credentials</strong>
            <p>Employee: employee@company.com / employee123</p>
            <p>Helpdesk: helpdesk@company.com / helpdesk123</p>
          </div>
        </section>
      </main>
    );
  }

  if (user.role === 'helpdesk') {
    return (
      <main className="dashboard-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">HELPDESK</p>
            <h2>Operations queue</h2>
          </div>
          <button type="button" className="logout-button" onClick={handleLogout}>Log out</button>
        </header>

        <section className="dashboard-panel">
          <p>Welcome, {user.firstName} {user.lastName}.</p>
          <p>Role: {user.role}</p>
          <p>Job title: {user.jobTitle ?? 'Not set'}</p>
          <p>This is the Helpdesk view. Priority setting and approvals belong here.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">EMPLOYEE</p>
          <h2>Request center</h2>
        </div>
        <button type="button" className="logout-button" onClick={handleLogout}>Log out</button>
      </header>

      <div className="employee-layout">
        <CreateTicketPage />
      </div>
    </main>
  );
}