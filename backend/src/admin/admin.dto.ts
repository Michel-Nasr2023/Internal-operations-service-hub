import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const MANAGED_ROLES = ['employee', 'helpdesk', 'administrator'] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export class HandoverDto {
  @IsIn(['reassign', 'queue'])
  mode!: 'reassign' | 'queue';

  // Required when mode is "reassign".
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  toUserId?: string;
}

export class AdminUserQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(MANAGED_ROLES)
  role?: ManagedRole;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

export class CreateUserDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsIn(MANAGED_ROLES)
  role!: ManagedRole;
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsIn(MANAGED_ROLES)
  role?: ManagedRole;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}
