import { FormEvent, useState } from 'react';
import { requestPasswordReset } from '../../api/auth';

interface ForgotPasswordPageProps {
  initialEmail?: string;
  onBackToLogin: () => void;
}

export function ForgotPasswordPage({ initialEmail = '', onBackToLogin }: ForgotPasswordPageProps) {
  const [email, setEmail] = useState(initialEmail);
  const [sentMessage, setSentMessage] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSending(true);
    try {
      setSentMessage(await requestPasswordReset(email.trim()));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The request could not be sent.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">OPS</span>
          <span className="brand-name">Internal Operations Service Hub</span>
        </div>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Forgot your password?</h1>

        {sentMessage ? (
          <>
            <div className="auth-notice" role="status">
              <strong>Check your email</strong>
              <p>{sentMessage} The link works once and expires in 30 minutes. If nothing arrives, check your spam folder or contact Helpdesk.</p>
            </div>
            <button type="button" className="auth-secondary-button" onClick={onBackToLogin}>Back to sign in</button>
          </>
        ) : (
          <>
            <p className="auth-copy">Enter the email address of your account and we'll send you a link to set a new password.</p>
            <form onSubmit={handleSubmit} className="auth-form">
              <label>
                Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required autoFocus />
              </label>
              {error && <p className="message error" role="alert">{error}</p>}
              <button type="submit" disabled={isSending}>{isSending ? 'Sending...' : 'Send reset link'}</button>
            </form>
            <p className="auth-switch">
              Remembered it? <button type="button" className="link-button" onClick={onBackToLogin}>Back to sign in</button>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
