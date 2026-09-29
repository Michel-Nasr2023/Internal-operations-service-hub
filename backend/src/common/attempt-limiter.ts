import { HttpException, HttpStatus } from '@nestjs/common';

// "Too many attempts": the reply says when to try again, also as a Retry-After header (see ApiExceptionFilter).
export class TooManyAttemptsException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message, error: 'Too Many Requests' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

// "in 12 minutes", "in 1 minute", "in 40 seconds".
export function waitDescription(seconds: number): string {
  if (seconds < 60) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

interface Window {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 50_000;

// Counts attempts per key (an email address, a network address) in fixed time windows. Kept in memory: it
// resets when the server restarts, which is acceptable for slowing down guessing and floods.
export class AttemptLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  // Seconds until this key may try again; 0 when it is not blocked.
  blockedFor(key: string): number {
    const window = this.current(key);
    return window && window.count >= this.limit ? Math.max(1, Math.ceil((window.resetAt - this.now()) / 1000)) : 0;
  }

  // Records one attempt. Returns true when this attempt used up the allowance, i.e. the key is now blocked.
  hit(key: string): boolean {
    let window = this.current(key);
    if (!window) {
      this.makeRoom();
      window = { count: 0, resetAt: this.now() + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count === this.limit;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private current(key: string): Window | undefined {
    const window = this.windows.get(key);
    if (window && window.resetAt <= this.now()) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  // Keeps memory bounded when very many different keys are used: expired windows go first, then the oldest.
  private makeRoom(): void {
    if (this.windows.size < MAX_TRACKED_KEYS) return;
    const now = this.now();
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
    for (const key of this.windows.keys()) {
      if (this.windows.size < MAX_TRACKED_KEYS) break;
      this.windows.delete(key);
    }
  }
}
