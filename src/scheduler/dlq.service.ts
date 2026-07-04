import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { dlqJobs } from '../database/schema';
import { CHARGE_QUEUE_TOKEN } from './scheduler.constants';
import type { ChargeJobPayload } from './scheduler.constants';

@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    @Inject(CHARGE_QUEUE_TOKEN)
    private readonly chargeQueue: Queue<ChargeJobPayload>,
  ) {}

  async listDlqJobs(): Promise<
    Array<{
      id: string;
      subscriptionId: string | null;
      payload: Record<string, unknown> | null;
      errorReason: string;
      retryHistory: unknown[];
      failedAt: string | null;
    }>
  > {
    this.logger.log('[DLQ] Listing all dead letter queue entries');
    const rows = await this.db.select().from(dlqJobs);
    return rows.map((row) => ({
      id: row.id,
      subscriptionId: row.subscriptionId,
      payload: row.payload
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : null,
      errorReason: row.errorReason,
      retryHistory: row.retryHistory
        ? (JSON.parse(row.retryHistory) as unknown[])
        : [],
      failedAt: row.failedAt,
    }));
  }

  async replayDlqJob(
    jobId: string,
  ): Promise<{ enqueued: true; jobId: string }> {
    const [row] = await this.db
      .select()
      .from(dlqJobs)
      .where(eq(dlqJobs.id, jobId));

    if (!row) {
      throw new NotFoundException('DLQ job not found: ' + jobId);
    }

    const payload = JSON.parse(row.payload) as ChargeJobPayload;

    await this.chargeQueue.add(
      'charge',
      { ...payload, retryCount: 0 },
      {
        jobId: 'replay-' + jobId + '-' + Date.now(),
        removeOnComplete: true,
      },
    );

    // Remove from DLQ after successful re-enqueue
    await this.db.delete(dlqJobs).where(eq(dlqJobs.id, jobId));

    this.logger.log(
      '[DLQ] Re-enqueued job ' +
        jobId +
        ' for subscription ' +
        row.subscriptionId,
    );
    return { enqueued: true, jobId };
  }
}
