import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressInfo } from 'node:net';
import { AppModule } from '../app.module';
import { UserEntity } from './user.entity';

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [UserEntity],
          synchronize: true,
        }),
        AppModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in an employee and a helpdesk user with their role', async () => {
    const employeeLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'employee@company.com', password: 'employee123' }),
    });

    const employee = (await employeeLogin.json()) as { id: string; role: string; email: string };

    expect(employeeLogin.status).toBe(201);
    expect(employee.role).toBe('employee');
    expect(employee.email).toBe('employee@company.com');

    const helpdeskLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helpdesk@company.com', password: 'helpdesk123' }),
    });

    const helpdesk = (await helpdeskLogin.json()) as { id: string; role: string; email: string };

    expect(helpdeskLogin.status).toBe(201);
    expect(helpdesk.role).toBe('helpdesk');
    expect(helpdesk.email).toBe('helpdesk@company.com');
  });
});
