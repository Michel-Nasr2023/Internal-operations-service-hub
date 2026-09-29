import { API_URL, apiFetch } from './http';

export type AuthRole = 'employee' | 'helpdesk' | 'assignee' | 'administrator';

export interface AuthUser {
  id: string;
  role: AuthRole;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  employeeId?: string;
  // When the profile photo last changed; null or missing when there is none.
  avatarUpdatedAt?: string | null;
  token: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
}

export interface DirectoryUser {
  id: string;
  firstName: string;
  lastName: string;
  role: AuthRole;
  jobTitle?: string;
  avatarUpdatedAt?: string | null;
}

const apiUrl = API_URL;
const AUTH_STORAGE_KEY = 'internal-ops-user';
export const SESSION_EXPIRED_EVENT = 'internal-ops-session-expired';

export function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.id || !parsed?.role || !parsed?.email || !parsed?.token) {
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function saveStoredUser(user: AuthUser): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const user = loadStoredUser();
  if (!user) {
    return {};
  }

  return { Authorization: `Bearer ${user.token}` };
}

// Adds the session token and signs the user out when the backend rejects it (expired or invalid).
export async function authFetch(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
  const response = await apiFetch(url, { ...init, headers: { ...init.headers, ...getAuthHeaders() } }, timeoutMs);

  if (response.status === 401) {
    clearStoredUser();
    // Pass the server's reason (e.g. "This account has been disabled") to the sign-in screen.
    const reason = await response
      .clone()
      .json()
      .then((body: { message?: string }) => body?.message)
      .catch(() => undefined);
    window.dispatchEvent(new CustomEvent<string | undefined>(SESSION_EXPIRED_EVENT, { detail: reason }));
  }

  return response;
}

export async function requestPasswordReset(email: string): Promise<string> {
  const response = await apiFetch(`${apiUrl}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? 'The request could not be sent.');
  return body?.message ?? 'If an account exists for that email, a reset link has been sent.';
}

export async function checkResetLink(token: string): Promise<{ valid: boolean; purpose?: 'reset' | 'invite'; email?: string }> {
  const response = await apiFetch(`${apiUrl}/auth/reset-password/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return response.ok ? response.json() : { valid: false };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const response = await apiFetch(`${apiUrl}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error((Array.isArray(body?.message) ? body.message.join(' ') : body?.message) ?? 'Your password could not be set.');
  }
}

async function postJson(path: string, body: object, fallback: string): Promise<unknown> {
  const response = await apiFetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error((Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message) ?? fallback);
  return payload;
}

// Checks the 6-digit code from the reset email (wrong codes count towards the attempt limit).
export async function verifyResetCode(email: string, code: string): Promise<void> {
  await postJson('/auth/reset-password/verify-code', { email, code }, 'The code could not be checked.');
}

export async function resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<void> {
  await postJson('/auth/reset-password', { email, code, newPassword }, 'Your password could not be changed.');
}

export async function logoutUser(): Promise<void> {
  await apiFetch(`${apiUrl}/auth/logout`, { method: 'POST', headers: getAuthHeaders() }).catch(() => undefined);
}

export async function loginUser(credentials: LoginCredentials): Promise<AuthUser> {
  const response = await apiFetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Unable to log in.');
  }

  return response.json() as Promise<AuthUser>;
}

export async function signupUser(input: SignupInput): Promise<AuthUser> {
  const response = await apiFetch(`${apiUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Unable to create the account.');
  }

  return response.json() as Promise<AuthUser>;
}

export async function listAssignableEmployees(): Promise<DirectoryUser[]> {
  const response = await authFetch(`${apiUrl}/auth/users?role=employee`);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The employee directory could not be loaded.');
  }

  return response.json() as Promise<DirectoryUser[]>;
}
