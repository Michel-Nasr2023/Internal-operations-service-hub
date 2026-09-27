import { FormEvent, useEffect, useState } from 'react';
import { checkResetLink, resetPassword } from '../../api/auth';
import { passwordProblem, passwordStrength } from '../../api/profile';

interface ResetPasswordPageProps {
  token: string;
  onDone: () => void;
  onRequestNewLink: () => void;
}

// Opened from the emailed link (?reset=...). Also used by invited users to set their first password.
export function ResetPasswordPage({ token, onDone, onRequestNewLink }: ResetPasswordPageProps) {
  const [link, setLink] = useState<{ valid: boolean; purpose?: 'reset' | 'invite'; email?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const strength = passwordStrength(password);
  const rule = password ? passwordProblem(password) : null;
  const isInvite = link?.purpose === 'invite';

  useEffect(() => {
    void checkResetLink(token).then(setLink);
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('The passwords do not match.');

    setIsSaving(true);
    try {
      await resetPassword(token, password);
      setIsDone(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Your password could not be set.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">OPS</span>
          <span className="brand-name">Internal Operations Service Hub</span>
        </div>
        <p className="eyebrow">{isInvite ? 'WELCOME' : 'ACCOUNT RECOVERY'}</p>
        <h1>{isInvite ? 'Set up your password' : 'Choose a new password'}</h1>

        {!link && <p className="auth-copy">Checking your link...</p>}

        {link && !link.valid && (
          <>
            <div className="auth-notice auth-notice-error" role="alert">
              <strong>This link can't be used</strong>
              <p>It has expired, was already used, or was replaced by a newer one. Request a new link to continue.</p>
            </div>
            <button type="button" onClick={onRequestNewLink}>Request a new link</button>
            <button type="button" className="auth-secondary-button" onClick={onDone}>Back to sign in</button>
          </>
        )}

        {link?.valid && isDone && (
          <>
            <div className="auth-notice" role="status">
              <strong>Password saved</strong>
              <p>You can now sign in with your new password. Any other sessions on your account were signed out.</p>
            </div>
            <button type="button" onClick={onDone}>Go to sign in</button>
          </>
        )}

        {link?.valid && !isDone && (
          <>
            <p className="auth-copy">
              For the account <strong>{link.email}</strong>. Use at least 8 characters with letters and numbers.
            </p>
            <form onSubmit={handleSubmit} className="auth-form">
              <label>
                New password
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" maxLength={100} required autoFocus />
              </label>
              {password && (
                <div className="password-strength" aria-live="polite">
                  <div className="password-strength-bar">
                    {[1, 2, 3, 4].map((step) => <span key={step} className={step <= strength.score ? `strength-${strength.score}` : undefined} />)}
                  </div>
                  <small>{rule ?? `Strength: ${strength.label}`}</small>
                </div>
              )}
              <label>
                Confirm new password
                <input type={showPassword ? 'text' : 'password'} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" maxLength={100} required />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
                Show passwords
              </label>
              {error && <p className="message error" role="alert">{error}</p>}
              <button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : isInvite ? 'Set password' : 'Save new password'}</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
