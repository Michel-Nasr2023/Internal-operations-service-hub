import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { describeError } from './common/log-safe';

const logger = new Logger('Server');

// Last line of defence. Known failure points (file streams, background jobs, email, AI) handle their own
// errors; anything that still slips through is logged here so one bad request cannot stop the hub for everyone.
process.on('unhandledRejection', (reason) => logger.error(`Unhandled promise rejection: ${describeError(reason)}`));
process.on('uncaughtException', (error) => logger.error(`Uncaught exception: ${describeError(error)}`));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // On the server the API sits behind a web server on the same machine (Caddy). Trust its X-Forwarded-For
  // header, and only from this machine, so sign-in limits and the audit log see each visitor's real address.
  app.set('trust proxy', 'loopback');
  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Ctrl+C / stop signals close the database and stop background timers cleanly.
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3000;
  // On the server HOST=127.0.0.1, so the API is reachable only through the web server, never directly.
  if (process.env.HOST) await app.listen(port, process.env.HOST);
  else await app.listen(port);
}

bootstrap().catch((error) => {
  // e.g. the port is already in use or the database cannot be opened: nothing can be served, so stop clearly.
  logger.error(`The server could not start: ${describeError(error)}`);
  process.exit(1);
});
