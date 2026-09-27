import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { verifyToken } from '../auth/token';
import { AuditService } from './audit.service';

// Sign-in and sign-up failures are audited by AuthService with more detail.
const SELF_AUDITED_PATHS = ['/api/auth/login', '/api/auth/signup'];

// Audits every refused request (401 missing/expired session, 403 not allowed), then replies exactly as
// Nest's default handler would for any HttpException.
@Catch(HttpException)
export class AccessDeniedFilter implements ExceptionFilter {
  constructor(private readonly auditService: AuditService) {}

  async catch(exception: HttpException, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status = exception.getStatus();

    if ((status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) && !SELF_AUDITED_PATHS.includes(request.path)) {
      const [scheme, token] = (request.header('authorization') ?? '').split(' ');
      const actor = scheme === 'Bearer' && token ? verifyToken(token) : null;
      const reason = exception.message;

      await this.auditService.record({
        category: 'access',
        action: status === HttpStatus.UNAUTHORIZED ? 'SESSION_REJECTED' : 'ACCESS_DENIED',
        outcome: 'denied',
        actor,
        summary: `${request.method} ${request.path} refused: ${reason}`,
        details: { method: request.method, path: request.path, status },
      });
    }

    const body = exception.getResponse();
    response.status(status).json(typeof body === 'object' ? body : { statusCode: status, message: body });
  }
}
