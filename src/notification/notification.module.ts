import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { NotificationWorkerService } from './notification-worker.service';
import { NotificationBotHandlerService } from './notification-bot-handler.service';
import { NotificationController } from './notification.controller';
import { TelegramClient } from './telegram-client';
import type { NotificationJobPayload } from './dto/notification.dto';

@Global()
@Module({
  controllers: [NotificationController],
  providers: [
    TelegramClient,
    NotificationService,
    NotificationBotHandlerService,
    NotificationWorkerService,
    {
      provide: 'NOTIFICATION_QUEUE',
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL')!;
        return new Queue<NotificationJobPayload>('notifications', {
          connection: { url: redisUrl },
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: ['NOTIFICATION_QUEUE', NotificationService],
})
export class NotificationModule implements OnModuleDestroy {
  constructor(
    @Inject('NOTIFICATION_QUEUE')
    private readonly notificationQueue: Queue<NotificationJobPayload>,
  ) {}

  async onModuleDestroy() {
    await this.notificationQueue.close();
  }
}
