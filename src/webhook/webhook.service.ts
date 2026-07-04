import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { transactions, subscriptions, plans, merchants } from '../database/schema';
import { computeNextPeriodEnd } from '../billing/billing-period.util';
import type { NombaWebhookEventDto } from './dto/webhook.dto';
import type { NotificationJobPayload } from '../notification/dto/notification.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    @Inject('NOTIFICATION_QUEUE')
    private readonly notificationQueue: Queue<NotificationJobPayload>,
  ) {}

  async processNombaEvent(
    event: NombaWebhookEventDto,
  ): Promise<{ status: string }> {
    const nombaRef = event.data.transaction.transactionId;

    const [tx] = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.nombaRef, nombaRef));

    if (!tx) {
      this.logger.warn(
        '[Webhook] orphaned_webhook — no matching transaction for nombaRef: ' +
          nombaRef,
      );
      return { status: 'orphaned' };
    }

    if (tx.status === 'success' || tx.status === 'failed') {
      this.logger.log(
        '[Webhook] Transaction ' +
          tx.id +
          ' already terminal (' +
          tx.status +
          ') — deduplicating',
      );
      return { status: 'duplicate' };
    }

    if (event.event_type === 'payment_success') {
      await this.db
        .update(transactions)
        .set({ status: 'success', response: JSON.stringify(event) })
        .where(eq(transactions.id, tx.id));

      if (tx.subscriptionId) {
        const sub = await this.db.query.subscriptions.findFirst({
          where: eq(subscriptions.id, tx.subscriptionId),
        });

        if (sub) {
          const [merchant] = await this.db.query.merchants.findFirst({
            where: eq(merchants.id, sub.customerId),
          });

          const plan = await this.db.query.plans.findFirst({
            where: eq(plans.id, sub.planId),
          });

          await this.advanceSubscription(tx.subscriptionId);

          await this.notificationQueue.add('notification', {
            merchantId: plan?.merchantId || 'unknown',
            eventType: 'payment_success',
            subscriptionId: tx.subscriptionId,
            transactionId: tx.id,
            amount: tx.amount || 0,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return { status: 'processed' };
    }

    if (event.event_type === 'payment_failed') {
      await this.db
        .update(transactions)
        .set({ status: 'failed', response: JSON.stringify(event) })
        .where(eq(transactions.id, tx.id));

      if (tx.subscriptionId) {
        const sub = await this.db.query.subscriptions.findFirst({
          where: eq(subscriptions.id, tx.subscriptionId),
        });

        if (sub) {
          const plan = await this.db.query.plans.findFirst({
            where: eq(plans.id, sub.planId),
          });

          await this.notificationQueue.add('notification', {
            merchantId: plan?.merchantId || 'unknown',
            eventType: 'payment_failed',
            subscriptionId: tx.subscriptionId,
            transactionId: tx.id,
            reason: 'webhook_reported_failure',
            timestamp: new Date().toISOString(),
          });
        }
      }
      return { status: 'processed' };
    }

    // payment_pending or any other event type we don't act on — no forward transition
    return { status: 'ignored' };
  }

  private async advanceSubscription(subscriptionId: string): Promise<void> {
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    });
    if (!sub) {
      return;
    }
    const plan = await this.db.query.plans.findFirst({
      where: eq(plans.id, sub.planId),
    });
    const nextPeriodEnd = computeNextPeriodEnd(plan?.interval ?? null);
    await this.db
      .update(subscriptions)
      .set({ status: 'active', currentPeriodEnd: nextPeriodEnd })
      .where(eq(subscriptions.id, subscriptionId));
  }
}
