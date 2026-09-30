import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { describeError } from './common/log-safe';
import { serveWebApp } from './system/web-app';

const logger = new Logger('Server');

// Last line of defence. Known failure points (file streams, background jobs, email, AI) handle their own
// errors; anything that still slips through is logged here so one bad request cannot stop the hub for everyone.
process.on('unhandledRejection', (reason) => logger.error(`Unhandled promise rejection: ${describeError(reason)}`));
process.on('uncaughtException', (error) => logger.error(`Uncaught exception: ${describeError(error)}`));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // When hosted, requests arrive through the host's proxy. Trusting its X-Forwarded-For header lets sign-in
  // limits and the audit log see each visitor's real address. TRUST_PROXY is the number of proxies in front
  // (Railway: 1); without it, only a proxy on this machine is trusted.
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', trustProxy ? (/^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy) : 'loopback');
  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (serveWebApp(app)) logger.log('Serving the web app and the API from one address.');
  // Stop signals (Ctrl+C, a redeploy) close the database and stop background timers cleanly.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error) => {
  // e.g. the port is already in use or the database cannot be opened: nothing can be served, so stop clearly.
  logger.error(`The server could not start: ${describeError(error)}`);
  process.exit(1);
});
