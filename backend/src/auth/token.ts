import 'dotenv/config';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthenticatedUser, UserRole } from '../tickets/ticket.types';

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const ALLOWED_ROLES: UserRole[] = ['employee', 'helpdesk', 'assignee', 'administrator'];

// Without AUTH_SECRET a random secret is used, so every restart signs everyone out.
const secret = process.env.AUTH_SECRET ?? randomBytes(32).toString('hex');
if (!process.env.AUTH_SECRET && process.env.NODE_ENV !== 'test') {
  console.warn('AUTH_SECRET is not set; using a temporary secret. Sessions will not survive a restart.');
}

interface TokenPayload {
  sub: string;
  role: UserRole;
  exp: number;
}

export function signToken(user: AuthenticatedUser): string {
  const payload: TokenPayload = { sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyToken(token: string): AuthenticatedUser | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== 'string' || !ALLOWED_ROLES.includes(payload.role)) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

  return { id: payload.sub, role: payload.role };
}

function sign(data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}
