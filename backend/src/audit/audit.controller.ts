import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, requireRole } from '../tickets/auth.decorator';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { AuditService } from './audit.service';

export class AuditLogQueryDto {
  @IsOptional()
  @IsIn(['auth', 'ticket', 'access'])
  category?: 'auth' | 'ticket' | 'access';

  @IsOptional()
  @IsIn(['success', 'failure', 'denied'])
  outcome?: 'success' | 'failure' | 'denied';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

@Controller('audit-log')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Full activity log (sign-ins, refused access, ticket actions). Helpdesk and administrators only.
  @Get()
  list(@Query() query: AuditLogQueryDto, @CurrentUser() user: AuthenticatedUser) {
    requireRole(user, 'helpdesk');
    return this.auditService.list(query);
  }
}
