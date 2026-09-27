import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, LoginRequestDto, ResetPasswordDto, ResetTokenDto, SignupRequestDto } from './auth.dto';
import { PasswordResetService } from './password-reset.service';
import { CurrentUser, requireRole } from '../tickets/auth.decorator';
import { AuthenticatedUser, UserRole } from '../tickets/ticket.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginRequestDto) {
    return this.authService.login(dto);
  }

  @Post('signup')
  async signup(@Body() dto: SignupRequestDto) {
    return this.authService.signup(dto);
  }

  // Always the same answer, whether or not the email has an account.
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordResetService.requestReset(dto.email);
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  // Lets the reset page say "this link has expired" before the user types a new password.
  @Post('reset-password/check')
  checkResetToken(@Body() dto: ResetTokenDto) {
    return this.passwordResetService.check(dto.token);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordResetService.reset(dto.token, dto.newPassword);
    return { message: 'Your password has been set. You can now sign in.' };
  }

  // Tokens are stateless, so sign-out is enforced client-side; this records it in the audit log.
  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(user);
    return { ok: true };
  }

  @Get('users')
  async listUsers(@Query('role') role: UserRole | undefined, @CurrentUser() user: AuthenticatedUser) {
    requireRole(user, 'helpdesk');
    return this.authService.listUsers(role);
  }
}
