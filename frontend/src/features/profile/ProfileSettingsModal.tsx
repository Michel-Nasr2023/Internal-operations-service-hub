import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { AuthUser } from '../../api/auth';
import {
  AVATAR_EXTENSIONS,
  changePassword,
  getProfile,
  MAX_AVATAR_BYTES,
  passwordProblem,
  passwordStrength,
  Profile,
  removeAvatar,
  updateProfile,
  uploadAvatar,
} from '../../api/profile';
import { isSoundMuted, playNotificationChime, setSoundMuted } from '../notifications/notificationSound';
import { Avatar } from './Avatar';
import { SettingsTab } from './ProfileMenu';

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  helpdesk: 'Helpdesk',
  assignee: 'Assignee',
  administrator: 'Administrator',
};

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Password & security' },
  { id: 'preferences', label: 'Preferences' },
];

interface ProfileSettingsModalProps {
  user: AuthUser;
  initialTab: SettingsTab;
  onClose: () => void;
  // Keeps the top bar and stored session in step with profile changes.
  onUserUpdated: (changes: Partial<AuthUser>) => void;
}

export function ProfileSettingsModal({ user, initialTab, onClose, onUserUpdated }: ProfileSettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={onClose}>
      <div className="modal-card settings-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">YOUR ACCOUNT</p>
            <h2 id="settings-title">Profile &amp; settings</h2>
          </div>
          <button type="button" className="icon-button modal-close" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'settings-tab settings-tab-active' : 'settings-tab'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="settings-panel">
          {tab === 'profile' && <ProfileTab user={user} onUserUpdated={onUserUpdated} />}
          {tab === 'security' && <SecurityTab onUserUpdated={onUserUpdated} />}
          {tab === 'preferences' && <PreferencesTab />}
        </div>
      </div>
    </div>
  );
}

function ProfileTab({ user, onUserUpdated }: { user: AuthUser; onUserUpdated: (changes: Partial<AuthUser>) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ firstName: user.firstName, lastName: user.lastName, jobTitle: user.jobTitle ?? '' });
  const [loadError, setLoadError] = useState('');
  const [saveMessage, setSaveMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [photoMessage, setPhotoMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPhotoBusy, setIsPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  useEffect(() => {
    getProfile()
      .then((loaded) => {
        setProfile(loaded);
        setForm({ firstName: loaded.firstName, lastName: loaded.lastName, jobTitle: loaded.jobTitle ?? '' });
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'Your profile could not be loaded.'));
  }, []);

  const isDirty =
    !!profile &&
    (form.firstName.trim() !== profile.firstName || form.lastName.trim() !== profile.lastName || form.jobTitle.trim() !== (profile.jobTitle ?? ''));

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveMessage(null);
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setSaveMessage({ kind: 'error', text: 'First and last name are required.' });
      return;
    }

    setIsSaving(true);
    try {
      const saved = await updateProfile({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), jobTitle: form.jobTitle.trim() });
      setProfile(saved);
      setForm({ firstName: saved.firstName, lastName: saved.lastName, jobTitle: saved.jobTitle ?? '' });
      onUserUpdated({ firstName: saved.firstName, lastName: saved.lastName, jobTitle: saved.jobTitle });
      setSaveMessage({ kind: 'success', text: 'Your profile was saved.' });
    } catch (error) {
      setSaveMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Your profile could not be saved.' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePhotoSelected(file: File | undefined) {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setPhotoMessage(null);

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!AVATAR_EXTENSIONS.includes(extension)) {
      setPhotoMessage({ kind: 'error', text: 'Choose a PNG, JPG or WebP image.' });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setPhotoMessage({ kind: 'error', text: 'The image is larger than 2 MB.' });
      return;
    }

    setIsPhotoBusy(true);
    try {
      const saved = await uploadAvatar(file);
      setProfile(saved);
      onUserUpdated({ avatarUpdatedAt: saved.avatarUpdatedAt });
      setPhotoMessage({ kind: 'success', text: 'Your profile photo was updated.' });
    } catch (error) {
      setPhotoMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The photo could not be uploaded.' });
    } finally {
      setIsPhotoBusy(false);
    }
  }

  async function handleRemovePhoto() {
    setPhotoMessage(null);
    setIsPhotoBusy(true);
    try {
      const saved = await removeAvatar();
      setProfile(saved);
      onUserUpdated({ avatarUpdatedAt: null });
      setPhotoMessage({ kind: 'success', text: 'Your profile photo was removed.' });
    } catch (error) {
      setPhotoMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The photo could not be removed.' });
    } finally {
      setIsPhotoBusy(false);
    }
  }

  if (loadError) return <p className="message error" role="alert">{loadError}</p>;
  if (!profile) return <p className="empty-state">Loading your profile...</p>;

  return (
    <div className="settings-section-stack">
      <section className="settings-section" aria-labelledby="photo-heading">
        <h3 id="photo-heading">Profile photo</h3>
        <div className="photo-row">
          <Avatar userId={profile.id} firstName={profile.firstName} lastName={profile.lastName} avatarUpdatedAt={profile.avatarUpdatedAt} size={88} />
          <div className="photo-actions">
            <p className="settings-hint">Shown in the top bar. PNG, JPG or WebP, up to 2 MB. A square photo looks best.</p>
            <div className="photo-buttons">
              <label htmlFor={fileInputId} className={isPhotoBusy ? 'settings-button settings-button-disabled' : 'settings-button'}>
                {profile.avatarUpdatedAt ? 'Change photo' : 'Upload photo'}
              </label>
              <input
                ref={fileInputRef}
                id={fileInputId}
                className="visually-hidden"
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                disabled={isPhotoBusy}
                onChange={(event) => void handlePhotoSelected(event.target.files?.[0])}
              />
              {profile.avatarUpdatedAt && (
                <button type="button" className="settings-button-secondary" onClick={() => void handleRemovePhoto()} disabled={isPhotoBusy}>
                  Remove
                </button>
              )}
            </div>
            {isPhotoBusy && <p className="settings-hint">Saving...</p>}
            {photoMessage && <p className={`message ${photoMessage.kind}`} role={photoMessage.kind === 'error' ? 'alert' : 'status'}>{photoMessage.text}</p>}
          </div>
        </div>
      </section>

      <form className="settings-section" onSubmit={handleSave} aria-labelledby="details-heading">
        <h3 id="details-heading">Personal details</h3>
        <div className="field-grid">
          <label>
            First name
            <input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} maxLength={80} required autoComplete="given-name" />
          </label>
          <label>
            Last name
            <input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} maxLength={80} required autoComplete="family-name" />
          </label>
        </div>
        <label>
          Job title
          <input value={form.jobTitle} onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))} maxLength={120} placeholder="e.g. Operations Analyst" autoComplete="organization-title" />
        </label>

        <dl className="settings-readonly">
          <div><dt>Email</dt><dd>{profile.email}</dd></div>
          <div><dt>Role</dt><dd>{ROLE_LABELS[profile.role] ?? profile.role}</dd></div>
          <div><dt>Employee ID</dt><dd className="mono">{profile.employeeId ?? profile.id}</dd></div>
          <div><dt>Member since</dt><dd>{new Date(profile.createdAt).toLocaleDateString()}</dd></div>
        </dl>
        <p className="settings-hint">Your email and role are managed by Helpdesk. Contact them if either needs to change.</p>

        {saveMessage && <p className={`message ${saveMessage.kind}`} role={saveMessage.kind === 'error' ? 'alert' : 'status'}>{saveMessage.text}</p>}
        <div className="settings-actions">
          <button type="submit" className="action-confirm" disabled={!isDirty || isSaving}>{isSaving ? 'Saving...' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

function SecurityTab({ onUserUpdated }: { onUserUpdated: (changes: Partial<AuthUser>) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastChanged, setLastChanged] = useState<string | null>(null);
  const strength = passwordStrength(next);
  const rule = next ? passwordProblem(next) : null;
  const mismatch = confirm.length > 0 && confirm !== next;

  useEffect(() => {
    getProfile()
      .then((profile) => setLastChanged(profile.passwordChangedAt))
      .catch(() => undefined);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const problem = passwordProblem(next);
    if (problem) return setMessage({ kind: 'error', text: problem });
    if (next !== confirm) return setMessage({ kind: 'error', text: 'The new passwords do not match.' });
    if (next === current) return setMessage({ kind: 'error', text: 'Choose a password that is different from your current one.' });

    setIsSaving(true);
    try {
      const token = await changePassword(current, next);
      // Keep this session working with the token issued after the change.
      onUserUpdated({ token });
      setCurrent('');
      setNext('');
      setConfirm('');
      setLastChanged(new Date().toISOString());
      setMessage({ kind: 'success', text: 'Your password was changed. You have been signed out on your other devices.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Your password could not be changed.' });
    } finally {
      setIsSaving(false);
    }
  }

  const inputType = showPasswords ? 'text' : 'password';

  return (
    <form className="settings-section" onSubmit={handleSubmit} aria-labelledby="password-heading">
      <h3 id="password-heading">Change password</h3>
      <p className="settings-hint">
        {lastChanged ? `Last changed ${new Date(lastChanged).toLocaleString()}.` : 'You have not changed your password yet.'} Use at least 8 characters with letters and numbers.
      </p>

      <label>
        Current password
        <input type={inputType} value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        New password
        <input type={inputType} value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" maxLength={100} required aria-describedby="password-strength" />
      </label>
      {next && (
        <div className="password-strength" id="password-strength" aria-live="polite">
          <div className="password-strength-bar">
            {[1, 2, 3, 4].map((step) => (
              <span key={step} className={step <= strength.score ? `strength-${strength.score}` : undefined} />
            ))}
          </div>
          <small>{rule ?? `Strength: ${strength.label}`}</small>
        </div>
      )}
      <label>
        Confirm new password
        <input type={inputType} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" maxLength={100} required />
      </label>
      {mismatch && <small className="field-error">The passwords do not match.</small>}

      <label className="checkbox-row">
        <input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} />
        Show passwords
      </label>

      {message && <p className={`message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <div className="settings-actions">
        <button type="submit" className="action-confirm" disabled={isSaving || !current || !next || !confirm}>{isSaving ? 'Changing...' : 'Change password'}</button>
      </div>
    </form>
  );
}

function PreferencesTab() {
  const [soundOn, setSoundOn] = useState(() => !isSoundMuted());

  function toggleSound(on: boolean) {
    setSoundOn(on);
    setSoundMuted(!on);
    if (on) playNotificationChime();
  }

  return (
    <section className="settings-section" aria-labelledby="preferences-heading">
      <h3 id="preferences-heading">Notifications</h3>
      <div className="preference-row">
        <div>
          <strong>Notification sound</strong>
          <p className="settings-hint">Play a short chime when a new notification arrives. Saved for this browser.</p>
        </div>
        <label className="switch">
          <input type="checkbox" role="switch" checked={soundOn} onChange={(event) => toggleSound(event.target.checked)} aria-label="Notification sound" />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>
      <button type="button" className="settings-button-secondary" onClick={playNotificationChime}>Play test sound</button>
    </section>
  );
}
