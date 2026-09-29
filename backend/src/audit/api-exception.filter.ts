import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { verifyToken } from '../auth/token';
import { TooManyAttemptsException } from '../common/attempt-limiter';
import { describeError } from '../common/log-safe';
import { AuditService } from './audit.service';
import { currentRequestContext } from './request-context';

// Sign-in and sign-up failures are audited by AuthService with more detail.
const SELF_AUDITED_PATHS = ['/api/auth/login', '/api/auth/signup'];

// Every error an API request ends with passes through here.
// - Expected errors (HttpException): refused requests (401 missing/expired session, 403 not allowed) are
//   audited, then the reply is the same as Nest's default, plus Retry-After when the caller must wait.
// - Unexpected errors: one safe log line (request ID, method, path, error code and message without paths,
//   URLs or emails; never the request data) and a plain 500 reply without internal details.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Requests');

  constructor(private readonly auditService: AuditService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (exception instanceof HttpException) {
      await this.replyToHttpException(exception, request, response);
      return;
    }

    // Errors from Express itself (e.g. a malformed JSON body) carry their own 4xx status.
    const clientError = exception as { status?: number; statusCode?: number; expose?: boolean; message?: string };
    const clientStatus = clientError.statusCode ?? clientError.status;
    if (typeof clientStatus === 'number' && clientStatus >= 400 && clientStatus < 500) {
      if (!response.headersSent) {
        response.status(clientStatus).json({ statusCode: clientStatus, message: clientError.expose && clientError.message ? clientError.message : 'Bad request' });
      }
      return;
    }

    const requestId = currentRequestContext()?.requestId ?? 'unknown';
    this.logger.error(`Request ${requestId} failed (${request.method} ${request.path}): ${describeError(exception)}`);
    if (!response.headersSent) {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' });
    }
  }

  private async replyToHttpException(exception: HttpException, request: Request, response: Response): Promise<void> {
    const status = exception.getStatus();

    if ((status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) && !SELF_AUDITED_PATHS.includes(request.path)) {
      const [scheme, token] = (request.header('authorization') ?? '').split(' ');
      const actor = scheme === 'Bearer' && token ? verifyToken(token) : null;

      await this.auditService.record({
        category: 'access',
        action: status === HttpStatus.UNAUTHORIZED ? 'SESSION_REJECTED' : 'ACCESS_DENIED',
        outcome: 'denied',
        actor,
        summary: `${request.method} ${request.path} refused: ${exception.message}`,
        details: { method: request.method, path: request.path, status },
      });
    }

    if (exception instanceof TooManyAttemptsException) response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    const body = exception.getResponse();
    response.status(status).json(typeof body === 'object' ? body : { statusCode: status, message: body });
  }
}
