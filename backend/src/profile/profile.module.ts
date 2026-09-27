import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UserEntity } from '../auth/user.entity';
import { ProfileController, UserAvatarController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), AuditModule],
  controllers: [ProfileController, UserAvatarController],
  providers: [ProfileService],
})
export class ProfileModule {}
