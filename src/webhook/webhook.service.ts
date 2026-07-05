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
  auditEvents,
} from '../database/schema';
import * as crypto from 'crypto';
import { computeNextPeriodEnd } from '../billing/billing-period.util';
import { EmailService } from '../common/services/email.service';
import type { NombaWebhookEventDto } from './dto/webhook.dto';
import type { NotificationJobPayload } from '../notification/dto/notification.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  /**
   * Writes a row to the audit trail. Best-effort — audit logging failures
   * must never block webhook processing.
   */
  private async logAuditEvent(event: {
    merchantId: string;
    customerId?: string;
    subscriptionId?: string;
    action: string;
    details?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.insert(auditEvents).values({
        id: `audit_${crypto.randomBytes(8).toString('hex')}`,
        merchantId: event.merchantId,
        customerId: event.customerId,
        subscriptionId: event.subscriptionId,
        action: event.action,
        details: event.details,
        metadata: event.metadata ? JSON.stringify(event.metadata) : undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Audit] Failed to log event ${event.action}: ${msg}`);
    }
  }

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

    this.logger.debug(
      '[Nomba Webhook] Processing event - event_type: ' +
        event.event_type +
        ', nombaRef/transactionId: ' +
        nombaRef,
    );

    const [tx] = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.nombaRef, nombaRef));

    if (!tx) {
      this.logger.warn(
        '[Webhook] orphaned_webhook — no matching transaction for nombaRef: ' +
          nombaRef +
          '. Event payload: ' +
          JSON.stringify(event),
      );
      return { status: 'orphaned' };
    }

    this.logger.debug(
      '[Nomba Webhook] Found matching transaction. tx.id: ' +
        tx.id +
        ', tx.nombaRef: ' +
        tx.nombaRef +
        ', tx.status: ' +
        tx.status,
    );

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
      this.logger.log(
        '[Nomba Webhook] Payment success for transactionId: ' +
          nombaRef +
          '. Merchant: ' +
          event.data.merchant.userId +
          ', Wallet: ' +
          event.data.merchant.walletId,
      );

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
          const wasRestoredFromPastDue = sub.status === 'past_due';

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

            await this.logAuditEvent({
              merchantId: plan.merchantId,
              customerId: sub.customerId,
              subscriptionId: tx.subscriptionId,
              action: wasRestoredFromPastDue
                ? 'subscription_restored'
                : 'payment_succeeded',
              details: wasRestoredFromPastDue
                ? `Subscription restored to active after successful retry — ₦${tx.amount}`
                : `Successful collection of ₦${tx.amount} for plan "${plan.name}"`,
              metadata: { nombaRef, transactionId: tx.id },
            });

            if (tokenKey) {
              await this.logAuditEvent({
                merchantId: plan.merchantId,
                customerId: sub.customerId,
                subscriptionId: tx.subscriptionId,
                action: 'card_tokenized',
                details: 'Customer card authorization tokenized via Nomba',
              });
            }
          }
        }
      }
      return { status: 'processed' };
    }

    if (event.event_type === 'payment_failed') {
      const failureReason =
        event.data.transaction.responseCodeMessage ||
        event.data.transaction.responseCode ||
        'Payment failed — please retry';

      this.logger.log(
        '[Nomba Webhook] Payment failed for transactionId: ' +
          nombaRef +
          '. Reason: ' +
          failureReason +
          ', Response code: ' +
          event.data.transaction.responseCode,
      );

      await this.db
        .update(transactions)
        .set({ status: 'failed', response: JSON.stringify(event) })
        .where(eq(transactions.id, tx.id));

      const customer = await this.db.query.customers.findFirst({
        where: eq(customers.id, tx.customerId),
      });

      let plan: Awaited<ReturnType<typeof this.db.query.plans.findFirst>> =
        undefined;

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

          if (plan) {
            await this.logAuditEvent({
              merchantId: plan.merchantId,
              customerId: sub.customerId,
              subscriptionId: tx.subscriptionId,
              action: 'payment_failed',
              details: `Payment attempt failed for plan "${plan.name}": ${failureReason}`,
              metadata: {
                nombaRef,
                transactionId: tx.id,
                responseCode: event.data.transaction.responseCode,
              },
            });
          }
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

  private renderPaymentFailedEmail(
    email: string,
    failureReason: string,
  ): string {
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
