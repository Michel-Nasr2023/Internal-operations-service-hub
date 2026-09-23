import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginRequestDto, SignupRequestDto } from './auth.dto';
import { CurrentUser, requireRole } from '../tickets/auth.decorator';
import { AuthenticatedUser, UserRole } from '../tickets/ticket.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginRequestDto) {
    return this.authService.login(dto);
  }

  @Post('signup')
  async signup(@Body() dto: SignupRequestDto) {
    return this.authService.signup(dto);
  }

  @Get('users')
  async listUsers(@Query('role') role: UserRole | undefined, @CurrentUser() user: AuthenticatedUser) {
    requireRole(user, 'helpdesk');
    return this.authService.listUsers(role);
  }
}
