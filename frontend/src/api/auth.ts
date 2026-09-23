export type AuthRole = 'employee' | 'helpdesk' | 'assignee' | 'administrator';

export interface AuthUser {
  id: string;
  role: AuthRole;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  employeeId?: string;
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
  role: 'employee' | 'helpdesk';
  jobTitle?: string;
}

export interface DirectoryUser {
  id: string;
  firstName: string;
  lastName: string;
  role: AuthRole;
  jobTitle?: string;
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
const AUTH_STORAGE_KEY = 'internal-ops-user';

export function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.id || !parsed?.role || !parsed?.email) {
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

  return {
    'x-user-id': user.id,
    'x-user-role': user.role,
    'x-user-employee-id': user.employeeId ?? user.id,
    'x-user-job-title': user.jobTitle ?? 'Operations Employee',
  };
}

export async function loginUser(credentials: LoginCredentials): Promise<AuthUser> {
  const response = await fetch(`${apiUrl}/auth/login`, {
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
  const response = await fetch(`${apiUrl}/auth/signup`, {
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
  const response = await fetch(`${apiUrl}/auth/users?role=employee`, { headers: getAuthHeaders() });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The employee directory could not be loaded.');
  }

  return response.json() as Promise<DirectoryUser[]>;
}
