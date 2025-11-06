import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  HealthCheckResult,
} from '@nestjs/terminus';
import { HealthService } from './health.service';
import { GrpcMethod } from '@nestjs/microservices';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private healthService: HealthService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    const mongoHealth = this.healthService.checkMongo();
    return {
      status: mongoHealth.status === 'up' ? 'ok' : 'error',
      info: {
        mongo: mongoHealth,
      },
    };
  }

  @GrpcMethod('Health', 'Check')
  async grpcHealthCheck(data: { service: string }): Promise<{
    status: number;
  }> {
    const mongoHealth = this.healthService.checkMongo();
    const status =
      mongoHealth.status === 'up' ? 1 : 2; // 1 = SERVING, 2 = NOT_SERVING

    return { status };
  }
}

