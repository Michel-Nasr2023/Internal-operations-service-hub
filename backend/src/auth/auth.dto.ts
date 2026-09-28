import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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

export class VerifyResetCodeDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'The code has 6 digits.' })
  code!: string;
}

// Either `token` (from the emailed link) or `email` + `code` (typed from the email).
export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  code?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  newPassword!: string;
}
