import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { NombaClient } from '../provider/nomba.client';
import { CircuitBreakerService } from '../provider/circuit-breaker.service';
import { CHARGE_QUEUE_TOKEN } from './scheduler.constants';
import type { ChargeJobPayload } from './scheduler.constants';

@Injectable()
export class HealthCronService {
  private readonly logger = new Logger(HealthCronService.name);

  constructor(
    private readonly nombaClient: NombaClient,
    private readonly circuitBreaker: CircuitBreakerService,
    @Inject(CHARGE_QUEUE_TOKEN)
    private readonly chargeQueue: Queue<ChargeJobPayload>,
  ) {}

  /**
   * Runs every 5 minutes. Pings Nomba health endpoint.
   * Pauses the ChargeQueue if the circuit breaker is OPEN.
   * Resumes the ChargeQueue if the circuit breaker recovers to CLOSED.
   */
  @Cron('*/5 * * * *')
  async runHealthCheck() {
    this.logger.log('[HealthCron] Running Nomba health check');

    const breakerState = this.circuitBreaker.getState();
    this.logger.log('[HealthCron] Circuit breaker state: ' + breakerState);

    if (breakerState === 'OPEN') {
      const isPaused = await this.chargeQueue.isPaused();
      if (!isPaused) {
        await this.chargeQueue.pause();
        this.logger.warn(
          '[HealthCron] ChargeQueue paused due to OPEN circuit breaker',
        );
      }
      return;
    }

    // Circuit breaker is CLOSED or HALF_OPEN — resume queue if paused
    const isPaused = await this.chargeQueue.isPaused();
    if (isPaused) {
      await this.chargeQueue.resume();
      this.logger.log(
        '[HealthCron] ChargeQueue resumed — circuit breaker is ' + breakerState,
      );
    }

    this.logger.log(
      '[HealthCron] Nomba health check complete — system operational',
    );
  }
}
