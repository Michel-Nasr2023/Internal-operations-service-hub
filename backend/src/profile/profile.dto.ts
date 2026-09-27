import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_PASSWORD_LENGTH } from '../auth/password-policy';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
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

  // An empty string clears the job title.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  jobTitle?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  newPassword!: string;
}
