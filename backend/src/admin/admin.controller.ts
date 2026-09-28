import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, requireAdministrator } from '../tickets/auth.decorator';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { AdminUserQueryDto, CreateUserDto, HandoverDto, UpdateUserDto } from './admin.dto';
import { AdminService } from './admin.service';

// Administrators only. Ticket work (queue, assignment, activity log) uses the regular endpoints,
// which already allow administrators.
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.overview();
  }

  @Get('users')
  listUsers(@Query() query: AdminUserQueryDto, @CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.listUsers(query);
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.createUser(dto, user);
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.updateUser(id, dto, user);
  }

  // Moves the person's Assigned / In Progress tickets to another employee or back to the Helpdesk queue.
  @Post('users/:id/handover')
  handOver(@Param('id') id: string, @Body() dto: HandoverDto, @CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.handOver(id, dto, user);
  }

  @Post('users/:id/password-reset')
  sendPasswordReset(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.sendPasswordReset(id, user);
  }

  @Post('users/:id/sign-out')
  signOutEverywhere(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.signOutEverywhere(id, user);
  }

  @Get('email-outbox')
  outbox(@CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.outbox();
  }

  @Get('system')
  system(@CurrentUser() user: AuthenticatedUser) {
    requireAdministrator(user);
    return this.adminService.system();
  }
}
