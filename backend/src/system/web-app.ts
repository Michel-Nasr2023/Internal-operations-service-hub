import { NextFunction, Request, Response } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_ROOT } from '../common/env';

const WEB_APP_DIR = join(BACKEND_ROOT, '..', 'frontend', 'dist');

// In production the API also serves the built React app (frontend/dist), so the whole hub is one service at one
// address. In development Vite serves the app instead, so this only runs with NODE_ENV=production.
export function serveWebApp(app: NestExpressApplication): boolean {
  const index = join(WEB_APP_DIR, 'index.html');
  if (process.env.NODE_ENV !== 'production' || !existsSync(index)) return false;

  // Built file names contain a content hash, so they can be cached for a long time.
  app.useStaticAssets(WEB_APP_DIR, { index: false, maxAge: '1y', immutable: true });
  // Every other page address (e.g. the reset link /?reset=...) loads the app; /api stays with the API.
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' || request.path.startsWith('/api')) return next();
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(index);
  });
  return true;
}
