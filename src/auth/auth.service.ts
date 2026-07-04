import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { apiKeys } from '../database/schema';
import { eq, and } from 'drizzle-orm';

@Injectable()
export class AuthService {
  constructor(@Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB) {}

  /**
   * Generates a cryptographically secure random API key.
   * Format: sk_{test|live}_{keyId}_{secretPart}
   * @param environment 'test' | 'live'
   * @returns { rawKey: string, keyId: string, secretPart: string }
   */
  generateApiKey(environment: 'test' | 'live'): {
    rawKey: string;
    keyId: string;
    secretPart: string;
  } {
    const keyId = crypto.randomBytes(8).toString('hex'); // 16 characters id
    const secretPart = crypto.randomBytes(24).toString('hex'); // 48 characters secret
    const rawKey = `sk_${environment}_${keyId}_${secretPart}`;
    return { rawKey, keyId, secretPart };
  }

  /**
   * Hashes the secret part of the API key for secure storage.
   */
  async hashSecret(secret: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(secret, salt);
  }

  /**
   * Validates a raw API key against database records.
   * @param rawKey The raw API key from authorization header
   * @returns The associated API key record with merchant context if valid, null otherwise
   */
  async validateApiKey(
    rawKey: string,
  ): Promise<{ merchantId: string; environment: 'test' | 'live' } | null> {
    const parts = rawKey.split('_');
    if (parts.length !== 4 || parts[0] !== 'sk') {
      return null;
    }

    const [, environment, keyId, secretPart] = parts;
    if (environment !== 'test' && environment !== 'live') {
      return null;
    }

    const [record] = await this.db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.environment, environment),
          eq(apiKeys.isActive, true),
        ),
      );

    if (!record) {
      return null;
    }

    const isMatch = await bcrypt.compare(secretPart, record.hashedKey);
    if (!isMatch) {
      return null;
    }

    return {
      merchantId: record.merchantId,
      environment: record.environment,
    };
  }

  /**
   * Revokes an API key by setting is_active to false.
   */
  async revokeApiKey(merchantId: string, keyId: string): Promise<boolean> {
    const result = await this.db
      .update(apiKeys)
      .set({ isActive: false })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.merchantId, merchantId)))
      .returning();
    return result.length > 0;
  }
}
