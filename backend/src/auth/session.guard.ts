import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { verifyToken } from './token';
import { UserEntity } from './user.entity';

export type RequestWithUser = Request & { authUser?: AuthenticatedUser };

// Runs on every request that carries a session token and checks it against the current account, so that
// disabling a user, changing their role, or ending their sessions takes effect immediately instead of when
// the token expires. Requests without a token pass through; routes that need one reject them via @CurrentUser.
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const [scheme, token] = (request.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return true;

    const verified = verifyToken(token);
    if (!verified) throw new UnauthorizedException('A valid sign-in session is required');

    const user = await this.userRepository.findOneBy({ id: verified.id });
    if (!user) throw new UnauthorizedException('This account no longer exists');
    if (user.status !== 'active') throw new UnauthorizedException('This account has been disabled');
    if (user.role !== verified.role) throw new UnauthorizedException('Your role has changed. Please sign in again.');
    if (user.sessionsRevokedAt && verified.issuedAt < Date.parse(user.sessionsRevokedAt)) {
      throw new UnauthorizedException('Your session has ended. Please sign in again.');
    }

    request.authUser = { id: user.id, role: user.role };
    return true;
  }
}
