import { authFetch } from './auth';

export type NotificationKind =
  | 'ticket-submitted'
  | 'ticket-approved'
  | 'ticket-rejected'
  | 'ticket-assigned'
  | 'ticket-unclaimed'
  | 'ticket-overdue'
  | 'ticket-resolved'
  | 'ticket-comment';

export interface AppNotification {
  id: string;
  ticketId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  createdAt: string;
  readAt?: string | null;
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export async function getNotifications(): Promise<AppNotification[]> {
  const response = await authFetch(`${apiUrl}/notifications`);

  if (!response.ok) {
    throw new Error('Notifications could not be loaded.');
  }

  return response.json() as Promise<AppNotification[]>;
}

export async function markNotificationRead(id: string): Promise<void> {
  await authFetch(`${apiUrl}/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await authFetch(`${apiUrl}/notifications/read-all`, { method: 'POST' });
}
