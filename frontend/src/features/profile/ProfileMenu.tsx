import { useEffect, useId, useRef, useState } from 'react';
import { AuthUser } from '../../api/auth';
import { Avatar } from './Avatar';

export type SettingsTab = 'profile' | 'security' | 'preferences';

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  helpdesk: 'Helpdesk',
  assignee: 'Assignee',
  administrator: 'Administrator',
};

interface ProfileMenuProps {
  user: AuthUser;
  onOpenSettings: (tab: SettingsTab) => void;
  onLogout: () => void;
}

// Avatar button in the top bar with the account menu.
export function ProfileMenu({ user, onOpenSettings, onLogout }: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  // Close on outside click or Escape (returning focus to the button).
  useEffect(() => {
    if (!isOpen) return;
    function handlePointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  // Move focus into the menu when it opens, so keyboard users can act straight away.
  useEffect(() => {
    if (isOpen) containerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [isOpen]);

  function handleMenuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  function choose(action: () => void) {
    setIsOpen(false);
    action();
  }

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="profile-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`Account menu for ${user.firstName} ${user.lastName}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Avatar userId={user.id} firstName={user.firstName} lastName={user.lastName} avatarUpdatedAt={user.avatarUpdatedAt} />
        <span className="profile-trigger-text">
          <strong>{user.firstName} {user.lastName}</strong>
          <small>{user.jobTitle || roleLabel}</small>
        </span>
        <span className="profile-chevron" aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <div className="profile-dropdown" id={menuId} role="menu" aria-label="Account" onKeyDown={handleMenuKeys}>
          <div className="profile-dropdown-header">
            <Avatar userId={user.id} firstName={user.firstName} lastName={user.lastName} avatarUpdatedAt={user.avatarUpdatedAt} size={48} />
            <div>
              <strong>{user.firstName} {user.lastName}</strong>
              <small>{user.email}</small>
              <span className="profile-role-badge">{roleLabel}{user.jobTitle ? ` · ${user.jobTitle}` : ''}</span>
            </div>
          </div>

          <button type="button" role="menuitem" className="profile-menu-item" onClick={() => choose(() => onOpenSettings('profile'))}>
            <span aria-hidden="true">👤</span> Profile &amp; settings
          </button>
          <button type="button" role="menuitem" className="profile-menu-item" onClick={() => choose(() => onOpenSettings('security'))}>
            <span aria-hidden="true">🔒</span> Change password
          </button>
          <button type="button" role="menuitem" className="profile-menu-item" onClick={() => choose(() => onOpenSettings('preferences'))}>
            <span aria-hidden="true">⚙️</span> Preferences
          </button>
          <div className="profile-menu-divider" role="separator" />
          <button type="button" role="menuitem" className="profile-menu-item profile-menu-item-danger" onClick={() => choose(onLogout)}>
            <span aria-hidden="true">↪</span> Log out
          </button>
        </div>
      )}
    </div>
  );
}
