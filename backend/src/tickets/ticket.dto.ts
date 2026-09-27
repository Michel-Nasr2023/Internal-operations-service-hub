import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { AI_ISSUE_TYPES, Priority, TEAM_IDS } from './ticket.types';

export class CreateTicketDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  description!: string;

  @IsIn(TEAM_IDS, { message: `teamId must be one of: ${TEAM_IDS.join(', ')}` })
  teamId!: string;

  @IsIn(AI_ISSUE_TYPES, { message: `issueType must be one of: ${AI_ISSUE_TYPES.join(', ')}` })
  issueType!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  project!: string;
}

export class AddCommentDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  body!: string;
}

export class RejectTicketDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class ResolveTicketDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  feedback!: string;
}

export class SetPriorityDto {
  @IsEnum(Priority)
  priority!: Priority;
}

export class AssignTicketDto {
  @IsNotEmpty()
  @IsString()
  assigneeId!: string;

  @IsInt()
  @IsPositive()
  @Min(1)
  expectedDurationHours!: number;
}

export class TicketListQueryDto {
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
}
