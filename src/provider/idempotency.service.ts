import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { idempotencyKeys } from '../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
  ) {}

  /**
   * Logs an idempotency key attempt prior to dispatching to the external provider.
   */
  async registerKey(id: string, requestType: string, payload: any): Promise<void> {
    await this.db
      .insert(idempotencyKeys)
      .values({
        id,
        requestType,
        payload: JSON.stringify(payload),
        status: 'pending',
      })
      .onConflictDoNothing(); // Prevent crash on existing retry
  }

  /**
   * Resolves the state of the request once the provider returns a response.
   */
  async resolveKey(id: string, status: 'completed' | 'failed', response: any): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({
        status,
        response: JSON.stringify(response),
      })
      .where(eq(idempotencyKeys.id, id));
  }

  /**
   * Retrieves an existing idempotency record.
   */
  async getKeyRecord(id: string) {
    const [record] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.id, id));
    
    if (record && record.response) {
      return {
        ...record,
        payload: JSON.parse(record.payload),
        response: JSON.parse(record.response),
      };
    }
    return record ? { ...record, payload: JSON.parse(record.payload) } : null;
  }
}
