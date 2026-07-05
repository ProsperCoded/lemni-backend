import { Injectable, Inject } from '@nestjs/common';
import { eq, and, or, like, sql, desc, inArray, type SQL } from 'drizzle-orm';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { notificationLogs } from '../database/schema';
import type {
  NotificationLogFilterDto,
  MarkNotificationsReadDto,
} from './dto/notification-log.dto';

@Injectable()
export class NotificationLogService {
  constructor(@Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB) {}

  async list(merchantId: string, filters: NotificationLogFilterDto) {
    const conditions: SQL[] = [eq(notificationLogs.merchantId, merchantId)];

    if (filters.severity) {
      conditions.push(eq(notificationLogs.severity, filters.severity));
    }
    if (filters.category) {
      conditions.push(eq(notificationLogs.category, filters.category));
    }
    if (filters.search) {
      const term = `%${filters.search}%`;
      const searchCondition = or(
        like(notificationLogs.message, term),
        like(notificationLogs.category, term),
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const limitVal = filters.limit ? Number(filters.limit) : 50;
    const offsetVal = filters.offset ? Number(filters.offset) : 0;

    const data = await this.db
      .select()
      .from(notificationLogs)
      .where(and(...conditions))
      .limit(limitVal)
      .offset(offsetVal)
      .orderBy(desc(notificationLogs.createdAt));

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(notificationLogs)
      .where(and(...conditions));

    const [unreadResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(notificationLogs)
      .where(
        and(
          eq(notificationLogs.merchantId, merchantId),
          eq(notificationLogs.read, false),
        ),
      );

    return {
      data,
      pagination: {
        total: countResult ? Number(countResult.count) : 0,
        limit: limitVal,
        offset: offsetVal,
      },
      unreadCount: unreadResult ? Number(unreadResult.count) : 0,
    };
  }

  async markRead(merchantId: string, body: MarkNotificationsReadDto) {
    const read = body.read ?? true;

    if (body.all) {
      await this.db
        .update(notificationLogs)
        .set({ read })
        .where(eq(notificationLogs.merchantId, merchantId));
      return { success: true };
    }

    if (body.ids && body.ids.length > 0) {
      await this.db
        .update(notificationLogs)
        .set({ read })
        .where(
          and(
            eq(notificationLogs.merchantId, merchantId),
            inArray(notificationLogs.id, body.ids),
          ),
        );
    }

    return { success: true };
  }

  async clear(merchantId: string) {
    await this.db
      .delete(notificationLogs)
      .where(eq(notificationLogs.merchantId, merchantId));
    return { success: true };
  }
}
