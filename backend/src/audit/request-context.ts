import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

// Per-request metadata for audit entries, so services don't have to pass the request around.
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

// Assigns a correlation ID (echoed as X-Request-Id) and captures the caller's IP and browser.
export function requestContextMiddleware(request: Request, response: Response, next: NextFunction): void {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  storage.run(
    {
      requestId,
      ip: request.ip ?? request.socket.remoteAddress,
      userAgent: request.header('user-agent')?.slice(0, 300),
    },
    next,
  );
}
