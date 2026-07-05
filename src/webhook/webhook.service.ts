import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import {
  transactions,
  subscriptions,
  plans,
  customers,
} from '../database/schema';
import { computeNextPeriodEnd } from '../billing/billing-period.util';
import { EmailService } from '../common/services/email.service';
import type { NombaWebhookEventDto } from './dto/webhook.dto';
import type { NotificationJobPayload } from '../notification/dto/notification.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    @Inject('NOTIFICATION_QUEUE')
    private readonly notificationQueue: Queue<NotificationJobPayload>,
    private readonly emailService: EmailService,
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
          const plan = await this.db.query.plans.findFirst({
            where: eq(plans.id, sub.planId),
          });

          await this.advanceSubscription(tx.subscriptionId);

          const tokenKey = event.data.tokenizedCardData?.tokenKey;
          if (tokenKey) {
            await this.db
              .update(customers)
              .set({ nombaToken: tokenKey })
              .where(eq(customers.id, sub.customerId));
          }

          if (plan) {
            await this.notificationQueue.add('notification', {
              merchantId: plan.merchantId,
              eventType: 'payment_success',
              subscriptionId: tx.subscriptionId,
              transactionId: tx.id,
              amount: tx.amount || 0,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
      return { status: 'processed' };
    }

    if (event.event_type === 'payment_failed') {
      await this.db
        .update(transactions)
        .set({ status: 'failed', response: JSON.stringify(event) })
        .where(eq(transactions.id, tx.id));

      const customer = await this.db.query.customers.findFirst({
        where: eq(customers.id, tx.customerId),
      });

      const failureReason =
        event.data.transaction.responseCodeMessage ||
        event.data.transaction.responseCode ||
        'Payment failed — please retry';

      let plan: any = null;

      if (tx.subscriptionId) {
        const sub = await this.db.query.subscriptions.findFirst({
          where: eq(subscriptions.id, tx.subscriptionId),
        });

        if (sub) {
          plan = await this.db.query.plans.findFirst({
            where: eq(plans.id, sub.planId),
          });

          await this.notificationQueue.add('notification', {
            merchantId: plan?.merchantId || 'unknown',
            eventType: 'payment_failed',
            subscriptionId: tx.subscriptionId,
            transactionId: tx.id,
            reason: failureReason,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (customer) {
        if (tx.subscriptionId && plan) {
          await this.emailService.sendPaymentFailedAlert(
            customer.email,
            plan.name,
            plan.amount,
            plan.gracePeriodDays || 0,
            tx.subscriptionId,
          );
        } else {
          const emailHtml = this.renderPaymentFailedEmail(
            customer.email,
            failureReason,
          );
          await this.emailService.sendEmail(
            customer.email,
            'Payment Failed — Action Required',
            emailHtml,
          );
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

  private renderPaymentFailedEmail(email: string, failureReason: string): string {
    const htmlContent = `
      <h2 class="title" style="color: #DC2626;">Payment Failed</h2>
      <p class="paragraph">
        Hello,
      </p>
      <p class="paragraph">
        We were unable to process your payment. Please review the details below and try again.
      </p>
      <div class="card" style="text-align: left; background-color: #FEF2F2; border-color: #FCA5A5; padding: 20px;">
        <p style="margin: 0 0 8px; color: #991B1B; font-weight: 600;">Reason for failure:</p>
        <p style="margin: 0; color: #7F1D1D; font-size: 15px;">
          ${failureReason}
        </p>
      </div>
      <p class="paragraph">
        Common reasons for payment failure include insufficient funds, expired card details, or processor declines. Please check with your bank or retry with a different card.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://checkout.nomba.com" class="button">Retry Payment</a>
      </div>
    `;

    // Inline import to avoid circular dependency
    const { renderBaseLayout } = require('../common/services/email-templates');
    return renderBaseLayout(
      {
        title: 'Lemni - Payment Failed',
        preheader: 'Your payment could not be processed.',
      },
      htmlContent,
    );
  }
}
