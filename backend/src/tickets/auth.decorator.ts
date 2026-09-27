import { createParamDecorator, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { verifyToken } from '../auth/token';
import { AuthenticatedUser, UserRole } from './ticket.types';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<Request & { authUser?: AuthenticatedUser }>();
  // Set by SessionGuard after checking the token against the account.
  if (request.authUser) return request.authUser;

  const [scheme, token] = (request.header('authorization') ?? '').split(' ');
  const verified = scheme === 'Bearer' && token ? verifyToken(token) : null;
  if (!verified) {
    throw new UnauthorizedException('A valid sign-in session is required');
  }

  return { id: verified.id, role: verified.role };
});

// Administrator-only actions (requireRole always lets administrators through; this lets only them through).
export function requireAdministrator(user: AuthenticatedUser): void {
  if (user.role !== 'administrator') {
    throw new ForbiddenException('Only administrators can do this');
  }
}

export function requireRole(user: AuthenticatedUser, ...roles: UserRole[]): void {
  if (!roles.includes(user.role) && user.role !== 'administrator') {
    throw new ForbiddenException('You are not authorized for this action');
  }
}
