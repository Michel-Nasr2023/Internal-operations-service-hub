import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser } from '../tickets/auth.decorator';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { ChangePasswordDto, UpdateProfileDto } from './profile.dto';
import { MAX_AVATAR_BYTES, ProfileService, UploadedAvatar } from './profile.service';

// The signed-in user's own profile. Every route acts on the caller only, so no one can edit someone else's.
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.get(user);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.profileService.update(user, dto);
  }

  @Post('password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.profileService.changePassword(user, dto);
  }

  // multipart/form-data with one `avatar` field.
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } }))
  setAvatar(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: UploadedAvatar | undefined) {
    return this.profileService.setAvatar(user, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.removeAvatar(user);
  }
}

@Controller('users')
export class UserAvatarController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @CurrentUser() _user: AuthenticatedUser, @Res() response: Response): Promise<void> {
    const { stream, mimeType, size } = await this.profileService.openAvatar(id);
    response.set({
      'Content-Type': mimeType,
      'Content-Length': String(size),
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    });
    stream.pipe(response);
  }
}
