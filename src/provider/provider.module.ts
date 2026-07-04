import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { NombaClient } from './nomba.client';

@Module({
  imports: [ConfigModule],
  providers: [CircuitBreakerService, NombaClient],
  exports: [CircuitBreakerService, NombaClient],
})
export class ProviderModule {}
export { NombaClient, CircuitBreakerService };
