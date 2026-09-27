import { useEffect, useRef, useState } from 'react';
import { AppNotification, getNotifications, markAllNotificationsRead, markNotificationRead, NotificationKind } from '../../api/notifications';
import { isSoundMuted, playNotificationChime, setSoundMuted } from './notificationSound';

const POLL_INTERVAL_MS = 15000;

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
    async function poll() {
      try {
        const latest = await getNotifications();
        const hasNewUnread = knownIds.current !== null && latest.some((notification) => !notification.readAt && !knownIds.current?.has(notification.id));
        knownIds.current = new Set(latest.map((notification) => notification.id));
        setNotifications(latest);

        if (hasNewUnread) {
          setIsRinging(true);
          if (!isMutedRef.current) playNotificationChime();
        }
      } catch {
        // Keep showing the last list; the next poll will retry.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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
        🔔
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
