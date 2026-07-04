import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  
  private state: BreakerState = 'CLOSED';
  private failureCount = 0;
  private readonly failureThreshold = 3;
  private readonly cooldownPeriod = 30000; // 30 seconds to attempt recovery
  private lastStateChange: number = Date.now();

  // Emits events when state changes (e.g. to pause/resume worker queues)
  public readonly stateChange$ = new Subject<{ state: BreakerState }>();

  getState(): BreakerState {
    // If state is OPEN and cooldown has elapsed, move to HALF_OPEN
    if (this.state === 'OPEN' && Date.now() - this.lastStateChange > this.cooldownPeriod) {
      this.transitionTo('HALF_OPEN');
    }
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === 'OPEN';
  }

  recordSuccess() {
    this.failureCount = 0;
    if (this.state !== 'CLOSED') {
      this.transitionTo('CLOSED');
    }
  }

  recordFailure() {
    this.failureCount++;
    this.logger.warn('Consecutive gateway failure count: ' + this.failureCount + '/' + this.failureThreshold);

    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.transitionTo('OPEN');
    } else if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN'); // Fail fast if a failure occurs in HALF_OPEN
    }
  }

  private transitionTo(newState: BreakerState) {
    this.logger.warn('Circuit Breaker state transitioning: ' + this.state + ' -> ' + newState);
    this.state = newState;
    this.lastStateChange = Date.now();
    this.stateChange$.next({ state: newState });
  }
}
