import { useEffect, useRef, useState } from 'react';
import { AppNotification, getNotifications, markAllNotificationsRead, markNotificationRead, NotificationKind } from '../../api/notifications';
import { isSoundMuted, playNotificationChime, setSoundMuted, SOUND_PREFERENCE_EVENT } from './notificationSound';

const POLL_INTERVAL_MS = 15000;
const MAX_POLL_INTERVAL_MS = 120000;

const KIND_LABELS: Record<NotificationKind, string> = {
  'ticket-submitted': 'New',
  'ticket-approved': 'Approved',
  'ticket-rejected': 'Rejected',
  'ticket-assigned': 'Assigned',
  'ticket-unclaimed': 'Unclaimed',
  'ticket-overdue': 'Overdue',
  'ticket-resolved': 'Resolved',
  'ticket-comment': 'Comment',
};

// Reuses the ticket status pill colours.
const KIND_PILL_CLASSES: Record<NotificationKind, string> = {
  'ticket-submitted': 'status-pending-helpdesk-review',
  'ticket-approved': 'status-approved',
  'ticket-rejected': 'status-rejected',
  'ticket-assigned': 'status-assigned',
  'ticket-unclaimed': 'status-pending-helpdesk-review',
  'ticket-overdue': 'status-rejected',
  'ticket-resolved': 'status-resolved',
  'ticket-comment': 'status-in-progress',
};

interface NotificationBellProps {
  onSelectTicket: (ticketId: string, kind: NotificationKind) => void;
}

export function NotificationBell({ onSelectTicket }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(isSoundMuted);
  const [isRinging, setIsRinging] = useState(false);
  // IDs already seen; null until the first load so existing notifications don't chime on sign-in.
  const knownIds = useRef<Set<string> | null>(null);
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  useEffect(() => {
    const sync = () => setIsMuted(isSoundMuted());
    window.addEventListener(SOUND_PREFERENCE_EVENT, sync);
    return () => window.removeEventListener(SOUND_PREFERENCE_EVENT, sync);
  }, []);

  // Checks every 15 s while the tab is visible. While the server is unreachable it waits longer between tries
  // (30 s, 1 min, up to 2 min) instead of hammering it, and it checks at once when the tab is shown again.
  useEffect(() => {
    let timer = 0;
    let failures = 0;
    let inFlight = false;
    let stopped = false;

    async function poll() {
      window.clearTimeout(timer);
      if (inFlight || stopped) return;
      inFlight = true;
      if (!document.hidden) {
        try {
          const latest = await getNotifications();
          const hasNewUnread = knownIds.current !== null && latest.some((notification) => !notification.readAt && !knownIds.current?.has(notification.id));
          knownIds.current = new Set(latest.map((notification) => notification.id));
          setNotifications(latest);
          failures = 0;

          if (hasNewUnread) {
            setIsRinging(true);
            if (!isMutedRef.current) playNotificationChime();
          }
        } catch {
          // Keep showing the last list; the next poll will retry.
          failures += 1;
        }
      }
      inFlight = false;
      if (!stopped) timer = window.setTimeout(() => void poll(), Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_POLL_INTERVAL_MS));
    }

    function onVisibilityChange() {
      if (!document.hidden) void poll();
    }

    void poll();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  function toggleMute() {
    const next = !isMuted;
    setIsMuted(next);
    setSoundMuted(next);
    if (!next) playNotificationChime();
  }

  function markAllRead() {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((notification) => ({ ...notification, readAt: notification.readAt ?? readAt })));
    void markAllNotificationsRead();
  }

  function selectNotification(notification: AppNotification) {
    if (!notification.readAt) {
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => (item.id === notification.id ? { ...item, readAt } : item)));
      void markNotificationRead(notification.id);
    }
    setIsOpen(false);
    onSelectTicket(notification.ticketId, notification.kind);
  }

  return (
    <div className="notification-bell">
      <button
        type="button"
        className={isRinging ? 'bell-button bell-button-ringing' : 'bell-button'}
        onAnimationEnd={() => setIsRinging(false)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        onClick={() => setIsOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && <span className="bell-badge">{unreadCount}</span>}
      </button>

      {isOpen && (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <span>Notifications</span>
            <div className="notification-panel-actions">
              <button
                type="button"
                className="mark-all-read"
                onClick={toggleMute}
                aria-pressed={isMuted}
                title={isMuted ? 'Turn notification sound on' : 'Turn notification sound off'}
              >
                {isMuted ? '🔕 Sound off' : '🔊 Sound on'}
              </button>
              {unreadCount > 0 && <button type="button" className="mark-all-read" onClick={markAllRead}>Mark all read</button>}
            </div>
          </div>

          {notifications.length === 0 && <p className="empty-state">No notifications yet.</p>}

          {notifications.length > 0 && (
            <ul className="notification-list">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={notification.readAt ? 'notification-item notification-item-read' : 'notification-item'}
                  onClick={() => selectNotification(notification)}
                >
                  <span className={`status-pill ${KIND_PILL_CLASSES[notification.kind] ?? ''}`}>{KIND_LABELS[notification.kind] ?? notification.kind}</span>
                  <div>
                    <strong>{notification.title}</strong>
                    <p className="notification-message">{notification.message}</p>
                    <small>Ticket {notification.ticketId.slice(0, 8)} · {new Date(notification.createdAt).toLocaleString()}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
