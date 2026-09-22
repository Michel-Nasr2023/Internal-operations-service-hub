import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../tickets/ticket.types';
import { LoginRequestDto } from './auth.dto';
import { UserEntity } from './user.entity';

export type AuthenticatedSession = AuthenticatedUser & {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  employeeId?: string;
};

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(@InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultUsers();
  }

  async login(dto: LoginRequestDto): Promise<AuthenticatedSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    if (!user || user.password !== dto.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('This account is not active');
    }

    return {
      id: user.id,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: user.jobTitle,
      employeeId: user.employeeId,
    };
  }

  private async seedDefaultUsers(): Promise<void> {
    const existingCount = await this.userRepository.count();
    if (existingCount > 0) {
      return;
    }

    const now = new Date().toISOString();
    const employees = [
      {
        id: 'employee-1',
        email: 'employee@company.com',
        password: 'employee123',
        role: 'employee' as const,
        firstName: 'Maya',
        lastName: 'Stone',
        jobTitle: 'Operations Analyst',
        employeeId: 'EMP-1001',
      },
      {
        id: 'helpdesk-1',
        email: 'helpdesk@company.com',
        password: 'helpdesk123',
        role: 'helpdesk' as const,
        firstName: 'Leo',
        lastName: 'Warren',
        jobTitle: 'Helpdesk Lead',
        employeeId: 'HELP-2001',
      },
    ];

    await this.userRepository.save(
      employees.map((employee) => ({
        ...employee,
        status: 'active',
        createdAt: now,
      })),
    );
  }
}
