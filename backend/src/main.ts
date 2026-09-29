import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const logger = new Logger('Server');

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

// Last line of defence. Known failure points (file streams, background jobs, email, AI) handle their own
// errors; anything that still slips through is logged here so one bad request cannot stop the hub for everyone.
process.on('unhandledRejection', (reason) => logger.error(`Unhandled promise rejection: ${describe(reason)}`));
process.on('uncaughtException', (error) => logger.error(`Uncaught exception: ${describe(error)}`));

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Ctrl+C / stop signals close the database and stop background timers cleanly.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error) => {
  // e.g. the port is already in use or the database cannot be opened: nothing can be served, so stop clearly.
  logger.error(`The server could not start: ${describe(error)}`);
  process.exit(1);
});
