import { ArgumentsHost, Logger } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';
import { AuditService } from './audit.service';

function httpContext() {
  const request = { method: 'POST', path: '/api/tickets', header: () => undefined };
  const response = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader: () => undefined,
  };
  const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ArgumentsHost;
  return { host, response };
}

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter({ record: async () => undefined } as unknown as AuditService);

  afterEach(() => jest.restoreAllMocks());

  it('answers an unexpected error with a plain 500 and logs one line without the request data', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, response } = httpContext();
    // What a database error looks like: the SQL parameters hold the ticket text.
    const failure = Object.assign(new Error('SQLITE_BUSY: database is locked'), { query: 'INSERT INTO tickets ...', parameters: ['Door will not open'] });

    await filter.catch(failure, host);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toContain('failed (POST /api/tickets): SQLITE_BUSY: database is locked');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('Door will not open');
  });

  it('keeps client mistakes such as a malformed JSON body as 400, without logging them as failures', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, response } = httpContext();

    await filter.catch(Object.assign(new SyntaxError('Unexpected token } in JSON'), { status: 400, expose: true }), host);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ statusCode: 400, message: 'Unexpected token } in JSON' });
    expect(logged).not.toHaveBeenCalled();
  });
});
