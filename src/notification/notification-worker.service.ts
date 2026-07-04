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
import { merchants } from '../database/schema';
import { NotificationService } from './notification.service';
import type { NotificationJobPayload } from './dto/notification.dto';

@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
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

    if (!merchant || !merchant.telegramChatId) {
      this.logger.log(
        `[NotificationWorker] No Telegram chat_id for merchant ${payload.merchantId} — skipping`,
      );
      return;
    }

    try {
      await this.notificationService.sendAlert(
        merchant.telegramChatId,
        payload,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('4xx')) {
        this.logger.warn(
          `[NotificationWorker] 4xx error (bot blocked/invalid chat): ${msg}`,
        );
        throw new Error('undeliverable_4xx');
      }

      this.logger.error(
        `[NotificationWorker] 5xx or transient error: ${msg}`,
      );
      throw error;
    }
  }
}
