import { FormEvent, useEffect, useState } from 'react';
import {
  AdminUser,
  createAdminUser,
  listAdminUsers,
  ManagedRole,
  sendUserPasswordReset,
  signOutUserEverywhere,
  updateAdminUser,
} from '../../api/admin';
import { Avatar } from '../profile/Avatar';

const ROLE_OPTIONS: Array<{ value: ManagedRole; label: string; description: string }> = [
  { value: 'employee', label: 'Employee', description: 'Submits tickets and works on tickets assigned to them.' },
  { value: 'helpdesk', label: 'Helpdesk', description: 'Reviews, prioritises and assigns every ticket; sees the activity log.' },
  { value: 'administrator', label: 'Administrator', description: 'Everything Helpdesk can do, plus managing people and the system.' },
];
const ROLE_LABELS: Record<string, string> = { employee: 'Employee', helpdesk: 'Helpdesk', administrator: 'Administrator', assignee: 'Assignee' };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

interface AdminUsersPageProps {
  currentUserId: string;
}

export function AdminUsersPage({ currentUserId }: AdminUsersPageProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [managingId, setManagingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function load() {
    setIsLoading(true);
    setError('');
    try {
      setUsers(await listAdminUsers({ search, role: roleFilter, status: statusFilter }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Users could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  function replaceUser(updated: AdminUser) {
    setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));
  }

  const managing = users.find((user) => user.id === managingId) ?? null;
  const activeCount = users.filter((user) => user.status === 'active').length;

  return (
    <div className="service-desk admin-page">
      <section className="tickets-card" aria-labelledby="users-title">
        <div className="card-heading">
          <div className="card-heading-title">
            <h2 id="users-title">Users</h2>
            <div className="queue-stats">
              <span><strong>{users.length}</strong> shown</span>
              <span><strong>{activeCount}</strong> active</span>
            </div>
          </div>
          <div className="card-heading-actions">
            <button type="button" className="action-confirm" onClick={() => setIsCreating(true)}>+ Add user</button>
            <button className="refresh-button" type="button" onClick={() => void load()} disabled={isLoading} aria-label="Refresh users" title="Refresh users">↻</button>
          </div>
        </div>

        <div className="filter-bar">
          <label className="filter-search">
            Search
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Name, email, job title or ID" />
          </label>
          <label>
            Role
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>

        {error && <p className="message error" role="alert">{error}</p>}
        {notice && <p className="message success" role="status">{notice}</p>}
        {isLoading && users.length === 0 && <p className="empty-state">Loading users...</p>}
        {!isLoading && users.length === 0 && !error && <p className="empty-state">No users match these filters.</p>}

        {users.length > 0 && (
          <div className="table-scroll">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Open requests</th>
                  <th>Active assignments</th>
                  <th>Last sign-in</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.status === 'disabled' ? 'row-disabled' : undefined}>
                    <td>
                      <div className="person-cell">
                        <Avatar userId={user.id} firstName={user.firstName} lastName={user.lastName} avatarUpdatedAt={user.avatarUpdatedAt} size={34} />
                        <div>
                          <strong>{user.firstName} {user.lastName}{user.id === currentUserId ? ' (you)' : ''}</strong>
                          <small>{user.email}{user.jobTitle ? ` · ${user.jobTitle}` : ''}</small>
                        </div>
                      </div>
                    </td>
                    <td><span className={`role-pill role-${user.role}`}>{ROLE_LABELS[user.role] ?? user.role}</span></td>
                    <td><span className={`status-pill ${user.status === 'active' ? 'status-resolved' : 'status-rejected'}`}>{user.status === 'active' ? 'Active' : 'Disabled'}</span></td>
                    <td>{user.openRequests}</td>
                    <td>{user.activeAssignments}</td>
                    <td className="nowrap">{formatDate(user.lastSignInAt)}</td>
                    <td>
                      <button type="button" className="review-button review-button-outline" onClick={() => { setNotice(''); setManagingId(user.id); }}>Manage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isCreating && (
        <CreateUserModal
          onClose={() => setIsCreating(false)}
          onCreated={(created) => {
            setIsCreating(false);
            setNotice(`Account created for ${created.firstName} ${created.lastName}. An invitation to set a password was emailed to ${created.email}.`);
            void load();
          }}
        />
      )}

      {managing && (
        <ManageUserModal
          user={managing}
          isSelf={managing.id === currentUserId}
          onClose={() => setManagingId(null)}
          onUpdated={replaceUser}
        />
      )}
    </div>
  );
}

function RoleSelect({ value, onChange, disabled }: { value: ManagedRole; onChange: (role: ManagedRole) => void; disabled?: boolean }) {
  return (
    <fieldset className="role-options" disabled={disabled}>
      <legend>Role</legend>
      {ROLE_OPTIONS.map((role) => (
        <label key={role.value} className={value === role.value ? 'role-option role-option-selected' : 'role-option'}>
          <input type="radio" name="role" value={role.value} checked={value === role.value} onChange={() => onChange(role.value)} />
          <span>
            <strong>{role.label}</strong>
            <small>{role.description}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (user: AdminUser) => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', jobTitle: '', role: 'employee' as ManagedRole });
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      onCreated(await createAdminUser({ ...form, jobTitle: form.jobTitle || undefined }));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The account could not be created.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-user-title" onClick={onClose}>
      <form className="modal-card settings-card" onClick={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">NEW ACCOUNT</p>
            <h2 id="create-user-title">Add a user</h2>
          </div>
          <button type="button" className="icon-button modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-section">
          <div className="field-grid">
            <label>
              First name
              <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} maxLength={80} required autoFocus />
            </label>
            <label>
              Last name
              <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} maxLength={80} required />
            </label>
          </div>
          <label>
            Work email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={200} required />
          </label>
          <label>
            Job title (optional)
            <input value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} maxLength={120} />
          </label>
          <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
          <p className="settings-hint">The person receives an email with a link to set their own password. The link expires after 72 hours; you can send a new one from Manage.</p>
          {error && <p className="message error" role="alert">{error}</p>}
          <div className="settings-actions">
            <button type="submit" className="action-confirm" disabled={isSaving}>{isSaving ? 'Creating...' : 'Create and send invitation'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ManageUserModal({ user, isSelf, onClose, onUpdated }: { user: AdminUser; isSelf: boolean; onClose: () => void; onUpdated: (user: AdminUser) => void }) {
  const managedRole: ManagedRole = user.role === 'assignee' ? 'employee' : user.role;
  const [form, setForm] = useState({ firstName: user.firstName, lastName: user.lastName, email: user.email, jobTitle: user.jobTitle ?? '', role: managedRole });
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'disable' | 'signout' | null>(null);

  const detailsChanged =
    form.firstName.trim() !== user.firstName || form.lastName.trim() !== user.lastName || form.email.trim().toLowerCase() !== user.email || form.jobTitle.trim() !== (user.jobTitle ?? '');
  const roleChanged = form.role !== managedRole;

  async function run(label: string, action: () => Promise<string>) {
    setMessage(null);
    setBusy(label);
    try {
      setMessage({ kind: 'success', text: await action() });
    } catch (actionError) {
      setMessage({ kind: 'error', text: actionError instanceof Error ? actionError.message : 'The action failed.' });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run('save', async () => {
      const updated = await updateAdminUser(user.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        jobTitle: form.jobTitle.trim(),
        ...(roleChanged ? { role: form.role } : {}),
      });
      onUpdated(updated);
      return roleChanged
        ? `Saved. ${updated.firstName} is now ${ROLE_LABELS[updated.role]} and must sign in again for it to apply.`
        : 'Saved.';
    });
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="manage-user-title" onClick={onClose}>
      <div className="modal-card settings-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="person-cell">
            <Avatar userId={user.id} firstName={user.firstName} lastName={user.lastName} avatarUpdatedAt={user.avatarUpdatedAt} size={52} />
            <div>
              <p className="eyebrow">MANAGE ACCOUNT{isSelf ? ' · YOU' : ''}</p>
              <h2 id="manage-user-title">{user.firstName} {user.lastName}</h2>
            </div>
          </div>
          <button type="button" className="icon-button modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <dl className="settings-readonly">
          <div><dt>Status</dt><dd>{user.status === 'active' ? 'Active' : 'Disabled'}</dd></div>
          <div><dt>Employee ID</dt><dd className="mono">{user.employeeId ?? user.id}</dd></div>
          <div><dt>Last sign-in</dt><dd>{formatDate(user.lastSignInAt)}</dd></div>
          <div><dt>Password changed</dt><dd>{formatDate(user.passwordChangedAt)}</dd></div>
          <div><dt>Open requests</dt><dd>{user.openRequests}</dd></div>
          <div><dt>Active assignments</dt><dd>{user.activeAssignments}</dd></div>
        </dl>

        {message && <p className={`message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}

        <form className="settings-section manage-section" onSubmit={saveDetails}>
          <h3>Details and role</h3>
          <div className="field-grid">
            <label>
              First name
              <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} maxLength={80} required />
            </label>
            <label>
              Last name
              <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} maxLength={80} required />
            </label>
          </div>
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={200} required />
          </label>
          <label>
            Job title
            <input value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} maxLength={120} />
          </label>
          <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} disabled={isSelf} />
          {isSelf && <p className="settings-hint">You cannot change your own role. Ask another administrator.</p>}
          {roleChanged && <p className="settings-hint">Changing the role signs this person out; the new role applies when they sign in again.</p>}
          <div className="settings-actions">
            <button type="submit" className="action-confirm" disabled={(!detailsChanged && !roleChanged) || busy !== null}>{busy === 'save' ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>

        <section className="settings-section manage-section" aria-labelledby="access-heading">
          <h3 id="access-heading">Access</h3>
          <div className="access-actions">
            <div className="access-action">
              <div>
                <strong>Send password reset link</strong>
                <small>Emails a single-use link that expires in 30 minutes.</small>
              </div>
              <button
                type="button"
                className="settings-button-secondary"
                disabled={busy !== null || user.status !== 'active'}
                onClick={() => void run('reset', async () => (await sendUserPasswordReset(user.id)).message)}
              >
                {busy === 'reset' ? 'Sending...' : 'Send link'}
              </button>
            </div>

            {!isSelf && (
              <div className="access-action">
                <div>
                  <strong>Sign out everywhere</strong>
                  <small>Ends every session this person has open, e.g. on a lost laptop.</small>
                </div>
                {confirming === 'signout' ? (
                  <div className="confirm-buttons">
                    <button type="button" className="settings-button-secondary" onClick={() => setConfirming(null)}>Cancel</button>
                    <button type="button" className="action-confirm action-confirm-reject" disabled={busy !== null} onClick={() => void run('signout', async () => (await signOutUserEverywhere(user.id)).message)}>Confirm</button>
                  </div>
                ) : (
                  <button type="button" className="settings-button-secondary" disabled={busy !== null} onClick={() => setConfirming('signout')}>Sign out</button>
                )}
              </div>
            )}

            {!isSelf && (
              <div className="access-action access-action-danger">
                <div>
                  <strong>{user.status === 'active' ? 'Disable account' : 'Enable account'}</strong>
                  <small>
                    {user.status === 'active'
                      ? `Blocks sign-in immediately.${user.activeAssignments > 0 ? ` They still have ${user.activeAssignments} active assignment${user.activeAssignments === 1 ? '' : 's'}; reassign them in the queue.` : ''}`
                      : 'Allows this person to sign in again.'}
                  </small>
                </div>
                {user.status === 'active' && confirming === 'disable' ? (
                  <div className="confirm-buttons">
                    <button type="button" className="settings-button-secondary" onClick={() => setConfirming(null)}>Cancel</button>
                    <button
                      type="button"
                      className="action-confirm action-confirm-reject"
                      disabled={busy !== null}
                      onClick={() => void run('status', async () => { onUpdated(await updateAdminUser(user.id, { status: 'disabled' })); return 'The account was disabled.'; })}
                    >
                      Disable
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={user.status === 'active' ? 'settings-button-danger' : 'settings-button-secondary'}
                    disabled={busy !== null}
                    onClick={() =>
                      user.status === 'active'
                        ? setConfirming('disable')
                        : void run('status', async () => { onUpdated(await updateAdminUser(user.id, { status: 'active' })); return 'The account was enabled.'; })
                    }
                  >
                    {user.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
