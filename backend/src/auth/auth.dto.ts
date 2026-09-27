import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginRequestDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class SignupRequestDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}

export class ResetPasswordDto extends ResetTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  newPassword!: string;
}
