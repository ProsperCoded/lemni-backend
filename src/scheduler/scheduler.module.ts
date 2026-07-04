import {
  Module,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { BillingWorkerService } from './billing-worker.service';
import { DunningWorkerService } from './dunning-worker.service';
import { HealthCronService } from './health-cron.service';
import { DlqService } from './dlq.service';
import { DlqController } from './dlq.controller';
import { DatabaseModule } from '../database/database.module';
import { ProviderModule } from '../provider/provider.module';
import {
  CHARGE_QUEUE,
  DUNNING_QUEUE,
  CHARGE_QUEUE_TOKEN,
  DUNNING_QUEUE_TOKEN,
} from './scheduler.constants';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, ProviderModule],
  providers: [
    {
      provide: CHARGE_QUEUE_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        return new Queue(CHARGE_QUEUE, { connection: { url: redisUrl } });
      },
    },
    {
      provide: DUNNING_QUEUE_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        return new Queue(DUNNING_QUEUE, { connection: { url: redisUrl } });
      },
    },
    BillingWorkerService,
    DunningWorkerService,
    HealthCronService,
    DlqService,
  ],
  controllers: [DlqController],
  exports: [CHARGE_QUEUE_TOKEN, DUNNING_QUEUE_TOKEN],
})
export class SchedulerModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerModule.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(CHARGE_QUEUE_TOKEN) private readonly chargeQueue: Queue,
    @Inject(DUNNING_QUEUE_TOKEN) private readonly dunningQueue: Queue,
  ) {}

  async onModuleDestroy() {
    await this.chargeQueue.close();
    await this.dunningQueue.close();
  }

  async onModuleInit() {
    // Verify Redis is reachable at startup. Crash-fast if it is not.
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const probe = new Redis(redisUrl!, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });

    try {
      await probe.connect();
      await probe.ping();
      this.logger.log('[SchedulerModule] Redis connectivity verified');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        '[SchedulerModule] Redis is unreachable at startup: ' + msg,
      );
      process.exit(1);
    } finally {
      probe.disconnect();
    }
  }
}
