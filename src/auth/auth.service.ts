import {
  Injectable,
  Inject,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DRIZZLE_PROVIDER } from '../database/database.provider';
import type { DrizzleDB } from '../database/database.provider';
import { apiKeys, merchants, otpVerifications } from '../database/schema';
import { eq, and, gte } from 'drizzle-orm';
import { EmailService } from '../common/services/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE_PROVIDER) private readonly db: DrizzleDB,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

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

  /**
   * Generate unique username from merchant name
   * Converts to lowercase, replaces spaces with hyphens, and appends counter if needed
   */
  private async generateUniqueUsername(name: string): Promise<string> {
    // Base username: lowercase, replace spaces with hyphens, remove special chars
    const baseUsername = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 20);

    // Check if username already exists
    let username = baseUsername;
    let counter = 1;
    let exists = true;

    while (exists) {
      const result = await this.db
        .select()
        .from(merchants)
        .where(eq(merchants.username, username));

      exists = result.length > 0;
      if (exists) {
        counter++;
        username = `${baseUsername}-${counter}`;
      }
    }

    return username;
  }

  /**
   * Register a new merchant account
   */
  async signup(
    email: string,
    password: string,
    name: string,
  ): Promise<{ id: string; email: string; name: string; username: string }> {
    if (!password || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existing = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.email, email));

    if (existing.length > 0) {
      throw new ConflictException('Email already registered');
    }

    const merchantId = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(password, 10);
    const username = await this.generateUniqueUsername(name);

    await this.db.insert(merchants).values({
      id: merchantId,
      email,
      name,
      username,
      hashedPassword,
    });

    return { id: merchantId, email, name, username };
  }

  /**
   * Authenticate merchant and return JWT tokens
   */
  async login(
    email: string,
    password: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    merchant: { id: string; email: string; name: string };
  }> {
    const result = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.email, email));

    const merchant = result[0];
    if (!merchant || !merchant.hashedPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      merchant.hashedPassword,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = { sub: merchant.id, email: merchant.email };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '1h',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    return {
      accessToken,
      refreshToken,
      merchant: { id: merchant.id, email: merchant.email, name: merchant.name },
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const accessToken = this.jwtService.sign(
        { sub: payload.sub, email: payload.email },
        { expiresIn: '1h' },
      );
      return { accessToken };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * List all API keys for a merchant (hides hashed keys, only shows keyId prefix)
   */
  async listApiKeys(merchantId: string): Promise<
    Array<{
      id: string;
      environment: string;
      isActive: boolean;
      createdAt: string | null;
    }>
  > {
    const keys = await this.db
      .select({
        id: apiKeys.id,
        environment: apiKeys.environment,
        isActive: apiKeys.isActive,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.merchantId, merchantId));

    return keys;
  }

  /**
   * Create and store a new API key, returning the unhashed key only once
   */
  async createApiKey(
    merchantId: string,
    environment: 'test' | 'live',
  ): Promise<{ rawKey: string; keyId: string; message: string }> {
    const { rawKey, keyId, secretPart } = this.generateApiKey(environment);
    const hashedSecret = await this.hashSecret(secretPart);

    await this.db.insert(apiKeys).values({
      id: keyId,
      merchantId,
      hashedKey: hashedSecret,
      environment,
    });

    return {
      rawKey,
      keyId,
      message: 'Store this key safely. You will not be able to see it again.',
    };
  }

  /**
   * Reset password verifying old password.
   */
  async resetPassword(
    email: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const result = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.email, email));

    const merchant = result[0];
    if (!merchant || !merchant.hashedPassword) {
      this.logger.warn(`Password reset attempt with invalid email: ${email}`);
      throw new BadRequestException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(oldPassword, merchant.hashedPassword);
    if (!isMatch) {
      this.logger.warn(
        `Password reset attempt with incorrect old password for: ${email}`,
      );
      throw new BadRequestException('Invalid email or password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.db
      .update(merchants)
      .set({
        hashedPassword,
      })
      .where(eq(merchants.id, merchant.id));

    this.logger.log(`Password successfully reset for merchant: ${email}`);

    return { success: true };
  }

  /**
   * Generate Telegram deep link for merchant to contact support/admin
   * Uses merchant username (not UUID) for privacy and better UX
   * The bot will receive the username and look up the merchant
   */
  async generateTelegramDeepLink(
    merchantId: string,
  ): Promise<{ telegramUrl: string }> {
    const botUsername = this.configService.get<string>('TELEGRAM_BOT_USERNAME');
    if (!botUsername) {
      throw new BadRequestException('Telegram bot username not configured');
    }

    // Get merchant to retrieve username
    const result = await this.db
      .select({ username: merchants.username })
      .from(merchants)
      .where(eq(merchants.id, merchantId));

    if (result.length === 0) {
      throw new BadRequestException('Merchant not found');
    }

    const merchantUsername = result[0].username;

    // Telegram deep link format: https://t.me/bot_username?start=merchant_username
    // The ?start parameter is passed to /start handler in the bot
    const telegramUrl = `https://t.me/${botUsername}?start=${encodeURIComponent(merchantUsername)}`;

    return { telegramUrl };
  }

  /**
   * Request password reset by email. Generates and sends a 6-digit OTP code.
   */
  async forgotPassword(email: string) {
    const [merchant] = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.email, email));

    // Return generic success to prevent email enumeration
    const genericResponse = {
      success: true,
      message: 'If the email exists, a password reset code has been sent.',
    };

    if (!merchant) {
      return genericResponse;
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Clean up previous OTPs for this merchant
    await this.db
      .delete(otpVerifications)
      .where(eq(otpVerifications.merchantId, merchant.id));

    // Save OTP
    const id = `otp_${crypto.randomBytes(8).toString('hex')}`;
    await this.db.insert(otpVerifications).values({
      id,
      merchantId: merchant.id,
      code,
      expiresAt,
    });

    // Send email via modular template
    await this.emailService.sendForgotPasswordOtp(email, code);

    return genericResponse;
  }

  /**
   * Verify Reset OTP and return short-lived Reset Token.
   */
  async verifyResetOtp(email: string, code: string) {
    const [merchant] = await this.db
      .select()
      .from(merchants)
      .where(eq(merchants.email, email));

    if (!merchant) {
      throw new BadRequestException('Invalid email or verification code');
    }

    const now = new Date().toISOString();
    const [otpRecord] = await this.db
      .select()
      .from(otpVerifications)
      .where(
        and(
          eq(otpVerifications.merchantId, merchant.id),
          eq(otpVerifications.code, code),
          gte(otpVerifications.expiresAt, now),
        ),
      );

    if (!otpRecord) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Clean up OTP
    await this.db
      .delete(otpVerifications)
      .where(eq(otpVerifications.id, otpRecord.id));

    // Generate short-lived reset token
    const token = this.jwtService.sign(
      { email, purpose: 'reset-password' },
      { expiresIn: '5m' },
    );

    return {
      success: true,
      token,
    };
  }

  /**
   * Reset password using Reset Token.
   */
  async resetPasswordWithToken(token: string, newPassword: string) {
    try {
      const payload = this.jwtService.verify(token);

      if (payload.purpose !== 'reset-password') {
        throw new BadRequestException('Invalid token purpose');
      }

      const email = payload.email;
      const [merchant] = await this.db
        .select()
        .from(merchants)
        .where(eq(merchants.email, email));

      if (!merchant) {
        throw new BadRequestException('Merchant not found');
      }

      if (newPassword.length < 8) {
        throw new BadRequestException(
          'Password must be at least 8 characters long',
        );
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await this.db
        .update(merchants)
        .set({ hashedPassword })
        .where(eq(merchants.id, merchant.id));

      return {
        success: true,
        message: 'Password reset successfully.',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Invalid or expired token: ${msg}`);
    }
  }
}
