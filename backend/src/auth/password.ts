import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PREFIX = 'scrypt';
const KEY_LENGTH = 64;

// scrypt runs on Node's worker threads, so hashing (~40 ms each) never blocks other requests while it works.
function derive(password: string, salt: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, length, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, KEY_LENGTH)).toString('hex');
  return `${PREFIX}$${salt}$${hash}`;
}

export function isHashedPassword(stored: string): boolean {
  return stored.startsWith(`${PREFIX}$`);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isHashedPassword(stored)) {
    // Legacy plain-text rows created before hashing was introduced.
    return safeEqual(Buffer.from(password), Buffer.from(stored));
  }

  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const actual = await derive(password, salt, expected.length);
  return safeEqual(actual, expected);
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
