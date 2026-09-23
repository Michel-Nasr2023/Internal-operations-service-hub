import { FormEvent, useState } from 'react';
import { AuthUser, signupUser, SignupInput } from '../../api/auth';

const initialForm: SignupInput = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  role: 'employee',
  jobTitle: '',
};

interface SignUpPageProps {
  onSignedUp: (user: AuthUser) => void;
  onBackToLogin: () => void;
}

export function SignUpPage({ onSignedUp, onBackToLogin }: SignUpPageProps) {
  const [form, setForm] = useState<SignupInput>(initialForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof SignupInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const user = await signupUser(form);
      onSignedUp(user);
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : 'Unable to create the account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">OPS</span>
          <span className="brand-name">Internal Operations Service Hub</span>
        </div>
        <p className="eyebrow">CREATE ACCOUNT</p>
        <h1>Sign up</h1>
        <p className="auth-copy">Add a new employee or Helpdesk account. The account ID is assigned automatically.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field-grid">
            <label>
              First name
              <input value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} placeholder="Jane" required />
            </label>
            <label>
              Last name
              <input value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} placeholder="Doe" required />
            </label>
          </div>

          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="jane.doe@company.com" required />
          </label>

          <label>
            Password
            <input type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} placeholder="Choose a password" required />
          </label>

          <div className="field-grid">
            <label>
              Role
              <select value={form.role} onChange={(event) => updateField('role', event.target.value)}>
                <option value="employee">Employee</option>
                <option value="helpdesk">Helpdesk</option>
              </select>
            </label>
            <label>
              Job title
              <input value={form.jobTitle} onChange={(event) => updateField('jobTitle', event.target.value)} placeholder="e.g. Operations Analyst" />
            </label>
          </div>

          {error && <p className="message error" role="alert">{error}</p>}

          <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account...' : 'Create account'}</button>
        </form>

        <div className="login-credentials">
          <p className="credentials-title">Already have an account?</p>
          <button type="button" className="link-button" onClick={onBackToLogin}>Back to sign in</button>
        </div>
      </section>
    </main>
  );
}
