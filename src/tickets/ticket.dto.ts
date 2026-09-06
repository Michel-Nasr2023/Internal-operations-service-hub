import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { Priority } from './ticket.types';

export class CreateTicketDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  description!: string;

  @IsNotEmpty()
  @IsString()
  teamId!: string;

  @IsNotEmpty()
  @IsString()
  issueType!: string;

  @IsNotEmpty()
  @IsString()
  project!: string;
}

export class RejectTicketDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
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
