import {
  Injectable,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { merchants, notificationLogs } from '../database/schema';
import * as crypto from 'crypto';
import { NotificationService } from './notification.service';
import type { NotificationJobPayload } from './dto/notification.dto';

const EVENT_META: Record<
  NotificationJobPayload['eventType'],
  {
    category: 'payment' | 'system' | 'subscription';
    severity: 'success' | 'warning' | 'info';
    describe: (p: NotificationJobPayload) => string;
  }
> = {
  payment_success: {
    category: 'payment',
    severity: 'success',
    describe: (p) =>
      `Successful collection of ₦${(p.amount ?? 0).toLocaleString()} for subscription ${p.subscriptionId ?? 'n/a'}.`,
  },
  payment_failed: {
    category: 'payment',
    severity: 'warning',
    describe: (p) =>
      `Payment attempt failed for subscription ${p.subscriptionId ?? 'n/a'}: ${p.reason ?? 'Unknown reason'}.`,
  },
  trial_ended: {
    category: 'subscription',
    severity: 'info',
    describe: (p) =>
      `Trial period ended for subscription ${p.subscriptionId ?? 'n/a'}. Billing has started.`,
  },
  grace_period_exhausted: {
    category: 'subscription',
    severity: 'warning',
    describe: (p) =>
      `Grace period exhausted for subscription ${p.subscriptionId ?? 'n/a'} after repeated failed retries. Access locked.`,
  },
  subscription_canceled: {
    category: 'subscription',
    severity: 'info',
    describe: (p) =>
      `Subscription ${p.subscriptionId ?? 'n/a'} canceled. Reason: ${p.reason ?? 'Merchant/customer initiated'}.`,
  },
  dunning_failed: {
    category: 'payment',
    severity: 'warning',
    describe: (p) =>
      `Dunning retry failed for subscription ${p.subscriptionId ?? 'n/a'}: ${p.reason ?? 'Max retries exhausted'}.`,
  },
};

@Injectable()
export class NotificationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationWorkerService.name);
  private worker: Worker<NotificationJobPayload> | null = null;

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    @Inject('NOTIFICATION_QUEUE')
    private readonly notificationQueue: Queue<NotificationJobPayload>,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL')!;
    const connection = { url: redisUrl };

    this.worker = new Worker<NotificationJobPayload>(
      'notifications',
      async (job) => {
        await this.processNotification(job.data);
      },
      { connection, concurrency: 5 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `[NotificationWorker] Job failed: ${job?.id} — ${err.message}`,
      );
    });

    this.logger.log('[NotificationWorker] Initialized');
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async processNotification(
    payload: NotificationJobPayload,
  ): Promise<void> {
    const [merchant] = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.id, payload.merchantId));

    let delivered = false;
    let deliveryError: Error | null = null;

    if (merchant?.telegramChatId) {
      try {
        await this.notificationService.sendAlert(
          merchant.telegramChatId,
          payload,
        );
        delivered = true;
      } catch (error: unknown) {
        deliveryError =
          error instanceof Error ? error : new Error(String(error));
      }
    } else {
      this.logger.log(
        `[NotificationWorker] No Telegram chat_id for merchant ${payload.merchantId} — logging only`,
      );
    }

    await this.persistNotificationLog(payload, delivered);

    if (deliveryError) {
      const msg = deliveryError.message;

      if (msg.includes('4xx')) {
        this.logger.warn(
          `[NotificationWorker] 4xx error (bot blocked/invalid chat): ${msg}`,
        );
        throw new Error('undeliverable_4xx');
      }

      this.logger.error(`[NotificationWorker] 5xx or transient error: ${msg}`);
      throw deliveryError;
    }
  }

  /**
   * Persists every notification event to notification_logs regardless of
   * Telegram delivery outcome, so the merchant dashboard has a real history
   * even for merchants who haven't connected Telegram.
   */
  private async persistNotificationLog(
    payload: NotificationJobPayload,
    delivered: boolean,
  ): Promise<void> {
    const meta = EVENT_META[payload.eventType];
    try {
      await this.db.insert(notificationLogs).values({
        id: `notif_${crypto.randomBytes(8).toString('hex')}`,
        merchantId: payload.merchantId,
        eventType: payload.eventType,
        category: meta.category,
        severity: meta.severity,
        message: meta.describe(payload),
        subscriptionId: payload.subscriptionId,
        delivered,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[NotificationWorker] Failed to persist notification log: ${msg}`,
      );
    }
  }
}
