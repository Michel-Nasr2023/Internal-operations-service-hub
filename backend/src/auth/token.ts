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
  // Issued-at in milliseconds.
  iat?: number;
}

export type VerifiedToken = AuthenticatedUser & { issuedAt: number };

export function signToken(user: AuthenticatedUser): string {
  const now = Date.now();
  const payload: TokenPayload = { sub: user.id, role: user.role, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS, iat: now };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyToken(token: string): VerifiedToken | null {
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

  return { id: payload.sub, role: payload.role, issuedAt: typeof payload.iat === 'number' ? payload.iat : 0 };
}

function sign(data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}
