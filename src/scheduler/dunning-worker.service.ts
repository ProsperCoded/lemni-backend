import {
  Injectable,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker, Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import {
  subscriptions,
  customers,
  plans,
  dlqJobs,
  merchants,
} from '../database/schema';
import { NombaClient } from '../provider/nomba.client';
import { CircuitBreakerService } from '../provider/circuit-breaker.service';
import { computeNextPeriodEnd } from '../billing/billing-period.util';
import type { ChargeJobPayload } from './scheduler.constants';
import {
  CHARGE_QUEUE,
  DUNNING_QUEUE,
  DUNNING_QUEUE_TOKEN,
} from './scheduler.constants';
import type { NotificationJobPayload } from '../notification/dto/notification.dto';

/**
 * Exponential backoff delays in milliseconds for dunning retries.
 * Retry 0: immediate (from ChargeQueue), Retry 1: 5 min, Retry 2: 30 min, Retry 3: 2 hours
 */
const BACKOFF_DELAYS_MS = [
  0,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
];

@Injectable()
export class DunningWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DunningWorkerService.name);
  private chargeWorker!: Worker<ChargeJobPayload>;
  private dunningWorker!: Worker<ChargeJobPayload>;

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    @Inject(DUNNING_QUEUE_TOKEN)
    private readonly dunningQueue: Queue<ChargeJobPayload>,
    @Inject('NOTIFICATION_QUEUE')
    private readonly notificationQueue: Queue<NotificationJobPayload>,
    private readonly configService: ConfigService,
    private readonly nombaClient: NombaClient,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL')!;
    const connection = { url: redisUrl };

    this.chargeWorker = new Worker<ChargeJobPayload>(
      CHARGE_QUEUE,
      (job) => this.processCharge(job),
      { connection, concurrency: 5 },
    );

    this.dunningWorker = new Worker<ChargeJobPayload>(
      DUNNING_QUEUE,
      (job) => this.processDunning(job),
      { connection, concurrency: 3 },
    );

    this.chargeWorker.on('failed', (job, err) => {
      this.logger.error(
        '[ChargeWorker] Job failed: ' +
          (job?.id ?? 'unknown') +
          ' — ' +
          err.message,
      );
    });

    this.dunningWorker.on('failed', (job, err) => {
      this.logger.error(
        '[DunningWorker] Job failed: ' +
          (job?.id ?? 'unknown') +
          ' — ' +
          err.message,
      );
    });

    this.chargeWorker.on('error', (err) => {
      this.logger.error('[ChargeWorker] Connection error: ' + err.message);
    });

    this.dunningWorker.on('error', (err) => {
      this.logger.error('[DunningWorker] Connection error: ' + err.message);
    });
  }

  async onModuleDestroy() {
    await this.chargeWorker?.close();
    await this.dunningWorker?.close();
  }

  /**
   * Processes a charge job from ChargeQueue.
   * If circuit breaker is OPEN, re-enqueues to DunningQueue with delay.
   * On non-retryable Nomba 4xx, sends to DunningQueue (if grace > 0) or DLQ.
   * On retryable 5xx/timeout, re-enqueues to DunningQueue with backoff.
   */
  private async processCharge(job: Job<ChargeJobPayload>): Promise<void> {
    const { subscriptionId, nombaToken, customerEmail, callbackUrl } =
      await this.resolveContext(job.data);

    if (!nombaToken || !customerEmail) {
      this.logger.warn(
        '[ChargeWorker] No nombaToken for subscription ' +
          subscriptionId +
          ' — setting past_due',
      );
      await this.db
        .update(subscriptions)
        .set({ status: 'past_due' })
        .where(eq(subscriptions.id, subscriptionId));
      return;
    }

    if (this.circuitBreaker.isOpen()) {
      this.logger.warn(
        '[ChargeWorker] Circuit breaker OPEN — re-queuing to DunningQueue: ' +
          subscriptionId,
      );
      await this.enqueueDunning(job.data, job.data.retryCount);
      return;
    }

    try {
      this.logger.log(
        '[ChargeWorker] Charging subscription ' +
          subscriptionId +
          ' — amount: ' +
          job.data.amount,
      );
      const chargeIdempotencyKey =
        'charge-' + subscriptionId + '-' + Date.now();
      const result = (await this.nombaClient.chargeTokenizedCard(
        chargeIdempotencyKey,
        {
          tokenKey: nombaToken,
          order: {
            orderReference: chargeIdempotencyKey,
            customerId: job.data.customerId,
            callbackUrl,
            customerEmail,
            amount: job.data.amount,
            currency: 'NGN',
            accountId: this.nombaClient.getAccountId(),
          },
        },
      )) as Record<string, unknown>;

      const responseData = (result.data as Record<string, unknown>) ?? {};
      const transactionRef =
        (responseData.orderReference as string | undefined) ?? 'n/a';
      this.logger.log(
        '[ChargeWorker] Charge succeeded for subscription ' +
          subscriptionId +
          ' — ref: ' +
          transactionRef,
      );
      this.circuitBreaker.recordSuccess();

      // Advance billing period
      const plan = await this.db.query.plans.findFirst({
        where: eq(plans.id, job.data.planId),
      });
      if (plan) {
        const nextPeriodEnd = computeNextPeriodEnd(plan.interval);
        await this.db
          .update(subscriptions)
          .set({ status: 'active', currentPeriodEnd: nextPeriodEnd })
          .where(eq(subscriptions.id, subscriptionId));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        '[ChargeWorker] Charge failed for subscription ' +
          subscriptionId +
          ': ' +
          msg,
      );
      this.circuitBreaker.recordFailure();

      const isRetryable = this.isRetryableError(err);

      if (isRetryable) {
        // 5xx / timeout — re-enqueue to DunningQueue with backoff
        await this.enqueueDunning(job.data, job.data.retryCount + 1);
      } else {
        // 4xx non-retryable — check grace period
        await this.handleNonRetryableFailure(job.data, msg);
      }
    }
  }

  private async processDunning(job: Job<ChargeJobPayload>) {
    const { subscriptionId } = job.data;

    // Check if subscription was reactivated while dunning was queued
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    });

    if (!sub || sub.status !== 'past_due') {
      this.logger.log(
        '[DunningWorker] Subscription ' +
          subscriptionId +
          ' is no longer past_due — discarding stale job',
      );
      return;
    }

    if (this.circuitBreaker.isOpen()) {
      this.logger.warn(
        '[DunningWorker] Circuit breaker OPEN — holding job in past_due, will retry when closed',
      );
      // BullMQ job will be re-attempted on next retry or delay
      throw new Error('Circuit breaker open — retry deferred');
    }

    const plan = await this.db.query.plans.findFirst({
      where: eq(plans.id, job.data.planId),
    });
    const customer = await this.db.query.customers.findFirst({
      where: eq(customers.id, job.data.customerId),
    });
    const merchant = await this.db.query.merchants.findFirst({
      where: eq(merchants.id, job.data.merchantId),
    });

    if (!plan || !customer?.nombaToken || !customer.email) {
      await this.handleGracePeriodExhausted(
        job.data,
        'Missing plan, nomba token, or customer email',
      );
      return;
    }

    const callbackUrl =
      merchant?.defaultRedirectUrl || 'https://lemni.com/checkout/success';

    const maxRetries = plan.gracePeriodDays;

    if (job.data.retryCount > maxRetries) {
      await this.handleGracePeriodExhausted(
        job.data,
        'Grace period exhausted after ' + job.data.retryCount + ' retries',
      );
      return;
    }

    try {
      this.logger.log(
        '[DunningWorker] Retrying charge for subscription ' +
          subscriptionId +
          ' (retry ' +
          job.data.retryCount +
          ')',
      );
      const dunningIdempotencyKey =
        'dunning-' + subscriptionId + '-retry-' + job.data.retryCount;
      await this.nombaClient.chargeTokenizedCard(dunningIdempotencyKey, {
        tokenKey: customer.nombaToken,
        order: {
          orderReference: dunningIdempotencyKey,
          customerId: job.data.customerId,
          callbackUrl,
          customerEmail: customer.email,
          amount: job.data.amount,
          currency: 'NGN',
          accountId: this.nombaClient.getAccountId(),
        },
      });

      this.circuitBreaker.recordSuccess();
      const nextPeriodEnd = computeNextPeriodEnd(plan.interval);
      await this.db
        .update(subscriptions)
        .set({ status: 'active', currentPeriodEnd: nextPeriodEnd })
        .where(eq(subscriptions.id, subscriptionId));

      this.logger.log(
        '[DunningWorker] Dunning retry succeeded for subscription ' +
          subscriptionId,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        '[DunningWorker] Retry failed for subscription ' +
          subscriptionId +
          ': ' +
          msg,
      );
      this.circuitBreaker.recordFailure();

      const nextRetry = job.data.retryCount + 1;
      if (nextRetry > maxRetries) {
        await this.handleGracePeriodExhausted(job.data, msg);
      } else {
        await this.enqueueDunning(job.data, nextRetry);
      }
    }
  }

  private async handleNonRetryableFailure(
    payload: ChargeJobPayload,
    reason: string,
  ) {
    const plan = await this.db.query.plans.findFirst({
      where: eq(plans.id, payload.planId),
    });
    if (plan && plan.gracePeriodDays > 0) {
      this.logger.warn(
        '[ChargeWorker] Non-retryable failure with grace period > 0 — enqueueing dunning: ' +
          payload.subscriptionId,
      );
      await this.enqueueDunning(payload, 1);
    } else {
      this.logger.warn(
        '[ChargeWorker] Non-retryable failure with no grace period — sending to DLQ: ' +
          payload.subscriptionId,
      );
      await this.sendToDlq(payload, reason);
    }
    await this.db
      .update(subscriptions)
      .set({ status: 'past_due' })
      .where(eq(subscriptions.id, payload.subscriptionId));
  }

  private async handleGracePeriodExhausted(
    payload: ChargeJobPayload,
    reason: string,
  ) {
    this.logger.warn(
      '[DunningWorker] Grace period exhausted for subscription ' +
        payload.subscriptionId +
        ' — canceling',
    );
    await this.db
      .update(subscriptions)
      .set({ status: 'canceled' })
      .where(eq(subscriptions.id, payload.subscriptionId));

    await this.notificationQueue.add('notification', {
      merchantId: payload.merchantId,
      eventType: 'grace_period_exhausted',
      subscriptionId: payload.subscriptionId,
      customerId: payload.customerId,
      reason,
      timestamp: new Date().toISOString(),
    });

    await this.sendToDlq(payload, reason);
  }

  private async enqueueDunning(payload: ChargeJobPayload, retryCount: number) {
    const delay =
      BACKOFF_DELAYS_MS[Math.min(retryCount, BACKOFF_DELAYS_MS.length - 1)];
    await this.dunningQueue.add(
      'dunning',
      { ...payload, retryCount },
      {
        jobId: 'dunning-' + payload.subscriptionId + '-retry-' + retryCount,
        delay,
      },
    );
    this.logger.log(
      '[DunningWorker] Enqueued dunning retry ' +
        retryCount +
        ' for subscription ' +
        payload.subscriptionId +
        ' in ' +
        delay +
        'ms',
    );
  }

  private async sendToDlq(payload: ChargeJobPayload, errorReason: string) {
    const dlqId = 'dlq-' + payload.subscriptionId + '-' + Date.now();
    await this.db.insert(dlqJobs).values({
      id: dlqId,
      subscriptionId: payload.subscriptionId,
      payload: JSON.stringify(payload),
      errorReason,
      retryHistory: JSON.stringify([
        {
          attempt: payload.retryCount,
          failedAt: new Date().toISOString(),
          reason: errorReason,
        },
      ]),
    });
    this.logger.warn(
      '[DunningWorker] Job moved to DLQ: ' +
        dlqId +
        ' for subscription ' +
        payload.subscriptionId,
    );
  }

  private async resolveContext(payload: ChargeJobPayload): Promise<{
    subscriptionId: string;
    nombaToken: string | null;
    merchantId: string;
    customerEmail: string | null;
    callbackUrl: string;
  }> {
    const customer = await this.db.query.customers.findFirst({
      where: eq(customers.id, payload.customerId),
    });
    const merchant = await this.db.query.merchants.findFirst({
      where: eq(merchants.id, payload.merchantId),
    });
    return {
      subscriptionId: payload.subscriptionId,
      nombaToken: customer?.nombaToken ?? null,
      merchantId: payload.merchantId,
      customerEmail: customer?.email ?? null,
      callbackUrl:
        merchant?.defaultRedirectUrl || 'https://lemni.com/checkout/success',
    };
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return (
        msg.includes('5') ||
        msg.includes('timeout') ||
        msg.includes('network') ||
        msg.includes('econnreset')
      );
    }
    return false;
  }
}
