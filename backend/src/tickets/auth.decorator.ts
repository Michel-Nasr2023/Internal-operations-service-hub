import { createParamDecorator, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { verifyToken } from '../auth/token';
import { AuthenticatedUser, UserRole } from './ticket.types';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<Request>();
  const [scheme, token] = (request.header('authorization') ?? '').split(' ');

  const user = scheme === 'Bearer' && token ? verifyToken(token) : null;
  if (!user) {
    throw new UnauthorizedException('A valid sign-in session is required');
  }

  return user;
});

export function requireRole(user: AuthenticatedUser, ...roles: UserRole[]): void {
  if (!roles.includes(user.role) && user.role !== 'administrator') {
    throw new ForbiddenException('You are not authorized for this action');
  }
}
