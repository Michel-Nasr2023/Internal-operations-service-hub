import { useEffect, useRef, useState } from 'react';
import { getMyTickets, getTickets, Ticket } from '../../api/tickets';

type BellRole = 'employee' | 'helpdesk';
type NotificationKind = 'approved' | 'rejected' | 'new-ticket';

interface TicketNotification {
  id: string;
  ticketId: string;
  title: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
}

const POLL_INTERVAL_MS = 10000;

function storageKey(prefix: string, userId: string): string {
  return `internal-ops-${prefix}-${userId}`;
}

function loadNotifications(userId: string): TicketNotification[] {
  const raw = localStorage.getItem(storageKey('notifications', userId));
  return raw ? (JSON.parse(raw) as TicketNotification[]) : [];
}

function loadKnownStatuses(userId: string): Record<string, string> {
  const raw = localStorage.getItem(storageKey('ticket-statuses', userId));
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

function loadSeenIds(userId: string): string[] {
  const raw = localStorage.getItem(storageKey('seen-ticket-ids', userId));
  return raw ? (JSON.parse(raw) as string[]) : [];
}

function kindLabel(kind: NotificationKind): string {
  if (kind === 'approved') return 'Approved';
  if (kind === 'rejected') return 'Rejected';
  return 'New';
}

function kindSlug(kind: NotificationKind): string {
  if (kind === 'new-ticket') return 'pending-helpdesk-review';
  return kind;
}

interface NotificationBellProps {
  userId: string;
  role: BellRole;
  onSelectTicket: (ticketId: string) => void;
}

export function NotificationBell({ userId, role, onSelectTicket }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<TicketNotification[]>(() => loadNotifications(userId));
  const [isOpen, setIsOpen] = useState(false);
  const knownStatuses = useRef<Record<string, string> | null>(null);
  const seenIds = useRef<Set<string> | null>(null);
  const isFreshSession = useRef<boolean | null>(null);

  if (knownStatuses.current === null) knownStatuses.current = loadKnownStatuses(userId);
  if (seenIds.current === null) seenIds.current = new Set(loadSeenIds(userId));
  if (isFreshSession.current === null) isFreshSession.current = seenIds.current.size === 0;

  useEffect(() => {
    localStorage.setItem(storageKey('notifications', userId), JSON.stringify(notifications));
  }, [notifications, userId]);

  useEffect(() => {
    async function poll() {
      let tickets: Ticket[];
      try {
        tickets = role === 'helpdesk' ? await getTickets() : await getMyTickets();
      } catch {
        return;
      }

      const newNotifications: TicketNotification[] = [];

      if (role === 'helpdesk') {
        const seen = seenIds.current ?? new Set<string>();
        for (const ticket of tickets) {
          if (!seen.has(ticket.id)) {
            if (!isFreshSession.current) {
              newNotifications.push({
                id: `${ticket.id}-new`,
                ticketId: ticket.id,
                title: ticket.title,
                kind: 'new-ticket',
                createdAt: new Date().toISOString(),
                read: false,
              });
            }
            seen.add(ticket.id);
          }
        }
        isFreshSession.current = false;
        seenIds.current = seen;
        localStorage.setItem(storageKey('seen-ticket-ids', userId), JSON.stringify([...seen]));
      } else {
        const statuses = knownStatuses.current ?? {};
        for (const ticket of tickets) {
          const previousStatus = statuses[ticket.id];
          if (previousStatus === 'Pending Helpdesk Review' && (ticket.status === 'Approved' || ticket.status === 'Rejected')) {
            newNotifications.push({
              id: `${ticket.id}-${ticket.status}`,
              ticketId: ticket.id,
              title: ticket.title,
              kind: ticket.status === 'Approved' ? 'approved' : 'rejected',
              createdAt: new Date().toISOString(),
              read: false,
            });
          }
          statuses[ticket.id] = ticket.status;
        }
        knownStatuses.current = statuses;
        localStorage.setItem(storageKey('ticket-statuses', userId), JSON.stringify(statuses));
      }

      if (newNotifications.length > 0) {
        setNotifications((current) => {
          const existingIds = new Set(current.map((notification) => notification.id));
          const filtered = newNotifications.filter((notification) => !existingIds.has(notification.id));
          return [...filtered, ...current];
        });
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [userId, role]);

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  function markAllRead() {
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
  }

  function selectNotification(notification: TicketNotification) {
    setNotifications((current) => current.map((item) => (item.id === notification.id ? { ...item, read: true } : item)));
    setIsOpen(false);
    onSelectTicket(notification.ticketId);
  }

  return (
    <div className="notification-bell">
      <button
        type="button"
        className="bell-button"
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
            {unreadCount > 0 && <button type="button" className="mark-all-read" onClick={markAllRead}>Mark all read</button>}
          </div>

          {notifications.length === 0 && <p className="empty-state">No notifications yet.</p>}

          {notifications.length > 0 && (
            <ul className="notification-list">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={notification.read ? 'notification-item notification-item-read' : 'notification-item'}
                  onClick={() => selectNotification(notification)}
                >
                  <span className={`status-pill status-${kindSlug(notification.kind)}`}>{kindLabel(notification.kind)}</span>
                  <div>
                    <strong>{notification.title}</strong>
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
