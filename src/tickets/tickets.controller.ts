import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, requireRole } from './auth.decorator';
import { AssignTicketDto, CreateTicketDto, RejectTicketDto, SetPriorityDto, TicketListQueryDto } from './ticket.dto';
import { AuthenticatedUser } from './ticket.types';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    requireRole(user, 'employee');
    return this.ticketsService.create(dto, user);
  }

  @Get()
  list(@Query() query: TicketListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.list(user, query.priority);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.findOne(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: SetPriorityDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.approve(id, dto, user);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.reject(id, dto, user);
  }

  @Patch(':id/priority')
  setPriority(@Param('id') id: string, @Body() dto: SetPriorityDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.setPriority(id, dto, user);
  }

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.assign(id, dto, user);
  }

  @Post(':id/claim')
  claim(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.claim(id, user);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.resolve(id, user);
  }

  @Get(':id/audit-events')
  auditEvents(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.auditEvents(id, user);
  }
}
