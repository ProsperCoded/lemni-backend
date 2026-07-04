import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdempotencyService } from './idempotency.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { NombaClient } from './nomba.client';

@Module({
  imports: [ConfigModule],
  providers: [IdempotencyService, CircuitBreakerService, NombaClient],
  exports: [IdempotencyService, CircuitBreakerService, NombaClient],
})
export class ProviderModule {}
export { NombaClient, IdempotencyService, CircuitBreakerService };
