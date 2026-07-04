import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { eq, and, lte } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { subscriptions, customers, plans } from '../database/schema';
import type { ChargeJobPayload } from './scheduler.constants';
import { CHARGE_QUEUE_TOKEN } from './scheduler.constants';

const PAGE_SIZE = 100;

@Injectable()
export class BillingWorkerService {
  private readonly logger = new Logger(BillingWorkerService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    @Inject(CHARGE_QUEUE_TOKEN)
    private readonly chargeQueue: Queue<ChargeJobPayload>,
  ) {}

  /**
   * Runs every hour. Queries for subscriptions that are:
   * 1. status=active and currentPeriodEnd <= NOW()  → charge is due
   * 2. status=trialing and trialEnd <= NOW()         → trial expired
   *
   * Uses cursor-based pagination to avoid memory spikes on large batches.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runBillingCycle() {
    this.logger.log('[BillingWorker] Starting hourly billing cycle');

    try {
      await this.processActiveSubscriptions();
      await this.processExpiredTrials();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        '[BillingWorker] Billing cycle failed — skipping this tick: ' + msg,
      );
      // Do NOT push partial job batches; retry on the next hourly tick
    }

    this.logger.log('[BillingWorker] Hourly billing cycle complete');
  }

  private async processActiveSubscriptions() {
    const now = new Date().toISOString();
    let lastId: string | undefined;
    let processed = 0;

    while (true) {
      const rows = await this.db
        .select({
          subId: subscriptions.id,
          customerId: subscriptions.customerId,
          planId: subscriptions.planId,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, 'active'),
            lte(subscriptions.currentPeriodEnd, now),
            ...(lastId ? [lte(subscriptions.id, lastId)] : []),
          ),
        )
        .limit(PAGE_SIZE);

      if (rows.length === 0) break;

      for (const row of rows) {
        const plan = await this.db.query.plans.findFirst({
          where: eq(plans.id, row.planId),
        });

        if (!plan) {
          this.logger.warn(
            '[BillingWorker] Plan not found for subscription ' +
              row.subId +
              ', skipping',
          );
          continue;
        }

        const customer = await this.db.query.customers.findFirst({
          where: eq(customers.id, row.customerId),
        });

        if (!customer) {
          this.logger.warn(
            '[BillingWorker] Customer not found for subscription ' +
              row.subId +
              ', skipping',
          );
          continue;
        }

        if (!customer.nombaToken) {
          this.logger.warn(
            '[BillingWorker] nombaToken missing for subscription ' +
              row.subId +
              ', setting past_due',
          );
          await this.db
            .update(subscriptions)
            .set({ status: 'past_due' })
            .where(eq(subscriptions.id, row.subId));
          continue;
        }

        const payload: ChargeJobPayload = {
          subscriptionId: row.subId,
          customerId: row.customerId,
          planId: row.planId,
          amount: plan.amount,
          merchantId: plan.merchantId,
          retryCount: 0,
        };

        await this.chargeQueue.add('charge', payload, {
          jobId: 'charge-' + row.subId + '-' + Date.now(),
          removeOnComplete: true,
        });

        processed++;
        this.logger.log(
          '[BillingWorker] Enqueued charge for subscription ' + row.subId,
        );
      }

      lastId = rows[rows.length - 1].subId;
      if (rows.length < PAGE_SIZE) break;
    }

    this.logger.log(
      '[BillingWorker] Processed ' + processed + ' active subscriptions',
    );
  }

  private async processExpiredTrials() {
    const now = new Date().toISOString();
    let lastId: string | undefined;
    let processed = 0;

    while (true) {
      const rows = await this.db
        .select({
          subId: subscriptions.id,
          customerId: subscriptions.customerId,
          planId: subscriptions.planId,
          trialEnd: subscriptions.trialEnd,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, 'trialing'),
            lte(subscriptions.trialEnd, now),
            ...(lastId ? [lte(subscriptions.id, lastId)] : []),
          ),
        )
        .limit(PAGE_SIZE);

      if (rows.length === 0) break;

      for (const row of rows) {
        const plan = await this.db.query.plans.findFirst({
          where: eq(plans.id, row.planId),
        });
        const customer = await this.db.query.customers.findFirst({
          where: eq(customers.id, row.customerId),
        });

        if (!plan || !customer) {
          this.logger.warn(
            '[BillingWorker] Missing plan or customer for trial subscription ' +
              row.subId,
          );
          continue;
        }

        if (customer.nombaToken) {
          // Card is on file — promote to active and enqueue first charge
          await this.db
            .update(subscriptions)
            .set({ status: 'active' })
            .where(eq(subscriptions.id, row.subId));

          const payload: ChargeJobPayload = {
            subscriptionId: row.subId,
            customerId: row.customerId,
            planId: row.planId,
            amount: plan.amount,
            merchantId: plan.merchantId,
            retryCount: 0,
          };

          await this.chargeQueue.add('charge', payload, {
            jobId: 'trial-charge-' + row.subId + '-' + Date.now(),
            removeOnComplete: true,
          });

          this.logger.log(
            '[BillingWorker] Trial ended (card present) — promoted to active: ' +
              row.subId,
          );
        } else {
          // No card — set past_due and dispatch webhook
          await this.db
            .update(subscriptions)
            .set({ status: 'past_due' })
            .where(eq(subscriptions.id, row.subId));

          // Dispatch trial.ended_no_card webhook via outbound queue (stub: log only)
          this.logger.warn(
            '[BillingWorker] Trial ended (no card) — subscription set to past_due: ' +
              row.subId +
              ' | event: trial.ended_no_card | merchant: ' +
              plan.merchantId,
          );
        }

        processed++;
      }

      lastId = rows[rows.length - 1].subId;
      if (rows.length < PAGE_SIZE) break;
    }

    this.logger.log(
      '[BillingWorker] Processed ' + processed + ' expired trials',
    );
  }
}
