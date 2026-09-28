import { FormEvent, useEffect, useState } from 'react';
import { AuthShowcase } from './AuthShowcase';
import { requestPasswordReset, resetPasswordWithCode, verifyResetCode } from '../../api/auth';
import { passwordProblem, passwordStrength } from '../../api/profile';

const RESEND_COOLDOWN_SECONDS = 60;

type Step = 'email' | 'code' | 'password' | 'done';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'email', label: 'Email' },
  { id: 'code', label: 'Code' },
  { id: 'password', label: 'New password' },
];

interface ForgotPasswordPageProps {
  initialEmail?: string;
  onBackToLogin: (email?: string) => void;
}

// Forgot password in three steps: request an email, type the 6-digit code from it, choose a new password.
// The email also contains a link that opens the reset page directly.
export function ForgotPasswordPage({ initialEmail = '', onBackToLogin }: ForgotPasswordPageProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const strength = passwordStrength(password);
  const rule = password ? passwordProblem(password) : null;
  const digits = code.replace(/\D/g, '');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(isResend = false) {
    setError('');
    setInfo('');
    setIsBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCode('');
      setStep('code');
      if (isResend) setInfo('A new code is on its way. Only the latest code works.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The code could not be sent.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCode();
  }

  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setInfo('');
    if (digits.length !== 6) return setError('Enter the 6-digit code from the email.');

    setIsBusy(true);
    try {
      await verifyResetCode(email.trim(), digits);
      setStep('password');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'The code could not be checked.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('The passwords do not match.');

    setIsBusy(true);
    try {
      await resetPasswordWithCode(email.trim(), digits, password);
      setStep('done');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Your password could not be changed.');
    } finally {
      setIsBusy(false);
    }
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <main className="auth-shell">
      <AuthShowcase />
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">OPS</span>
          <span className="brand-name">Internal Operations Service Hub</span>
        </div>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>{step === 'done' ? 'Password updated' : 'Reset your password'}</h1>

        {step !== 'done' && (
          <ol className="auth-steps" aria-label="Progress">
            {STEPS.map((item, index) => (
              <li key={item.id} className={index < stepIndex ? 'auth-step-done' : index === stepIndex ? 'auth-step-current' : undefined} aria-current={index === stepIndex ? 'step' : undefined}>
                <span>{index < stepIndex ? '✓' : index + 1}</span>
                {item.label}
              </li>
            ))}
          </ol>
        )}

        {step === 'email' && (
          <>
            <p className="auth-copy">Enter the email address of your account. We'll email you a 6-digit code and a link to set a new password.</p>
            <form onSubmit={handleEmail} className="auth-form">
              <label>
                Email
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required autoFocus />
              </label>
              {error && <p className="message error" role="alert">{error}</p>}
              <button type="submit" disabled={isBusy}>{isBusy ? 'Sending...' : 'Send code'}</button>
            </form>
          </>
        )}

        {step === 'code' && (
          <>
            <p className="auth-copy">
              If <strong>{email.trim()}</strong> has an account, we've sent it a 6-digit code. It expires in 15 minutes. Check your spam folder if you don't see it.
            </p>
            <form onSubmit={handleCode} className="auth-form">
              <label>
                Verification code
                <input
                  className="code-input"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  aria-describedby="code-help"
                  required
                  autoFocus
                />
              </label>
              <small id="code-help" className="settings-hint">You can also open the link in the email instead.</small>
              {info && <p className="message success" role="status">{info}</p>}
              {error && <p className="message error" role="alert">{error}</p>}
              <button type="submit" disabled={isBusy || digits.length !== 6}>{isBusy ? 'Checking...' : 'Verify code'}</button>
            </form>
            <div className="auth-links">
              <button type="button" className="link-button" disabled={cooldown > 0 || isBusy} onClick={() => void sendCode(true)}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
              <button type="button" className="link-button" onClick={() => { setStep('email'); setError(''); setInfo(''); }}>Use a different email</button>
            </div>
          </>
        )}

        {step === 'password' && (
          <>
            <p className="auth-copy">Code confirmed. Choose a new password for <strong>{email.trim()}</strong>: at least 8 characters with letters and numbers.</p>
            <form onSubmit={handlePassword} className="auth-form">
              <label>
                New password
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" maxLength={100} required autoFocus />
              </label>
              {password && (
                <div className="password-strength" aria-live="polite">
                  <div className="password-strength-bar">
                    {[1, 2, 3, 4].map((item) => <span key={item} className={item <= strength.score ? `strength-${strength.score}` : undefined} />)}
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
              <button type="submit" disabled={isBusy}>{isBusy ? 'Saving...' : 'Save new password'}</button>
            </form>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="auth-notice" role="status">
              <strong>You're all set</strong>
              <p>Your password was changed and any other sessions on your account were signed out. Sign in with your new password.</p>
            </div>
            <button type="button" onClick={() => onBackToLogin(email.trim())}>Go to sign in</button>
          </>
        )}

        {step !== 'done' && (
          <p className="auth-switch">
            Remembered it? <button type="button" className="link-button" onClick={() => onBackToLogin()}>Back to sign in</button>
          </p>
        )}
      </section>
    </main>
  );
}
