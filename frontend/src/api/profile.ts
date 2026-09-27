import { authFetch } from './auth';

export interface Profile {
  id: string;
  email: string;
  role: 'employee' | 'helpdesk' | 'assignee' | 'administrator';
  firstName: string;
  lastName: string;
  jobTitle?: string;
  employeeId?: string;
  avatarUpdatedAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
}

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
export const MIN_PASSWORD_LENGTH = 8;

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

async function readError(response: Response, fallback: string): Promise<Error> {
  const error = await response.json().catch(() => null);
  const message = Array.isArray(error?.message) ? error.message.join(' ') : error?.message;
  return new Error(response.status === 413 ? 'The image is larger than 2 MB.' : message ?? fallback);
}

export async function getProfile(): Promise<Profile> {
  const response = await authFetch(`${apiUrl}/profile`);
  if (!response.ok) throw await readError(response, 'Your profile could not be loaded.');
  return response.json() as Promise<Profile>;
}

export async function updateProfile(input: { firstName: string; lastName: string; jobTitle: string }): Promise<Profile> {
  const response = await authFetch(`${apiUrl}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await readError(response, 'Your profile could not be saved.');
  return response.json() as Promise<Profile>;
}

// Returns the new session token: changing the password signs out every other session.
export async function changePassword(currentPassword: string, newPassword: string): Promise<string> {
  const response = await authFetch(`${apiUrl}/profile/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) throw await readError(response, 'Your password could not be changed.');
  return ((await response.json()) as { token: string }).token;
}

export async function uploadAvatar(file: File): Promise<Profile> {
  const form = new FormData();
  form.append('avatar', file, file.name);
  const response = await authFetch(`${apiUrl}/profile/avatar`, { method: 'POST', body: form });
  if (!response.ok) throw await readError(response, 'The photo could not be uploaded.');
  return response.json() as Promise<Profile>;
}

export async function removeAvatar(): Promise<Profile> {
  const response = await authFetch(`${apiUrl}/profile/avatar`, { method: 'DELETE' });
  if (!response.ok) throw await readError(response, 'The photo could not be removed.');
  return response.json() as Promise<Profile>;
}

// Photos need the session header, so they are fetched once and shown from an in-memory blob URL.
// The key includes when the photo last changed, so a new photo is fetched instead of the cached one.
const avatarCache = new Map<string, Promise<string | null>>();

export function loadAvatarUrl(userId: string, avatarUpdatedAt: string): Promise<string | null> {
  const key = `${userId}:${avatarUpdatedAt}`;
  let pending = avatarCache.get(key);
  if (!pending) {
    pending = authFetch(`${apiUrl}/users/${encodeURIComponent(userId)}/avatar`)
      .then(async (response) => (response.ok ? URL.createObjectURL(await response.blob()) : null))
      .catch(() => null);
    avatarCache.set(key, pending);
  }
  return pending;
}

// 0 = empty, 1 = weak ... 4 = strong. Only guidance: the server enforces the actual rules.
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: '' };
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || password.length < MIN_PASSWORD_LENGTH) score = Math.min(score, 1);
  const clamped = Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
  return { score: clamped, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][clamped] };
}

// Mirrors the server rule so the user sees the problem before submitting.
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use both letters and numbers.';
  if (password.trim() !== password) return 'Remove spaces at the start or end.';
  return null;
}
