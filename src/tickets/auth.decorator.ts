import { BadRequestException, createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser, UserRole } from './ticket.types';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<Request>();
  const id = request.header('x-user-id');
  const role = request.header('x-user-role') as UserRole | undefined;
  const allowedRoles: UserRole[] = ['employee', 'helpdesk', 'assignee', 'administrator'];

  if (!id || !role || !allowedRoles.includes(role)) {
    throw new BadRequestException('x-user-id and a valid x-user-role header are required');
  }

  return { id, role };
});

export function requireRole(user: AuthenticatedUser, ...roles: UserRole[]): void {
  if (!roles.includes(user.role) && user.role !== 'administrator') {
    throw new ForbiddenException('You are not authorized for this action');
  }
}
