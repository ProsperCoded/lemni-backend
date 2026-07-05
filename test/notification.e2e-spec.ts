import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import * as crypto from 'crypto';
import { AppModule } from './../src/app.module';
import { DRIZZLE_PROVIDER } from './../src/database/database.provider';
import {
  merchants,
  apiKeys,
  transactions,
  subscriptions,
  customers,
  plans,
  otpVerifications,
  dlqJobs,
} from './../src/database/schema';
import { eq } from 'drizzle-orm';

describe('Notification Module (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication<App>;
  let db: any;
  let jwtService: JwtService;
  let merchantJwt: string;
  const botSecret = 'dev_bot_secret_test_key_123';

  const testMerchant = {
    id: 'merchant-notification-test',
    name: 'Notification Test Merchant',
    email: 'notification-test@merchant.com',
    username: 'notification_test_merchant',
    defaultRedirectUrl: 'https://lemni.com',
    telegramChatId: null,
  };

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_SECRET = botSecret;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get(DRIZZLE_PROVIDER);
    jwtService = moduleFixture.get(JwtService);

    // Clean ALL tables in FK order before seeding
    await db.delete(otpVerifications);
    await db.delete(dlqJobs);
    await db.delete(apiKeys);
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);

    await db.insert(merchants).values(testMerchant);

    // Generate JWT token for merchant dashboard (admin endpoints)
    merchantJwt = jwtService.sign(
      { sub: testMerchant.id, email: testMerchant.email },
      { expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    await db.delete(otpVerifications);
    await db.delete(dlqJobs);
    await db.delete(apiKeys);
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);
    await app.close();
  });

  describe('POST /api/v1/webhooks/telegram (Bot Webhook)', () => {
    it('should reject webhook request without secret token (401)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .send({
          update_id: 10001,
          message: {
            message_id: 1,
            chat: { id: 123456789, type: 'private' },
            text: `/start ${testMerchant.username}`,
          },
        })
        .expect(401);
    });

    it('should reject webhook request with invalid secret token (401)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', 'invalid_secret_here')
        .send({
          update_id: 10001,
          message: {
            message_id: 1,
            chat: { id: 123456789, type: 'private' },
            text: `/start ${testMerchant.username}`,
          },
        })
        .expect(401);
    });

    it('should handle /start command with invalid username gracefully (200)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', botSecret)
        .send({
          update_id: 10001,
          message: {
            message_id: 1,
            from: { id: 123456789, is_bot: false, first_name: 'Test' },
            chat: { id: 123456789, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start nonexistent-merchant-user',
          },
        })
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should successfully connect Telegram with valid start command (200)', async () => {
      const chatId = '987654321';
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', botSecret)
        .send({
          update_id: 10001,
          message: {
            message_id: 1,
            from: { id: parseInt(chatId), is_bot: false, first_name: 'Test' },
            chat: { id: parseInt(chatId), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: `/start ${testMerchant.username}`,
          },
        })
        .expect(200);

      expect(response.body).toEqual({ received: true });

      // Verify database was updated
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, testMerchant.id));

      expect(merchant.telegramChatId).toBe(chatId);
    });

    it('should update existing Telegram connection with new chat_id (200)', async () => {
      const newChatId = '111222333';
      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', botSecret)
        .send({
          update_id: 10002,
          message: {
            message_id: 2,
            from: {
              id: parseInt(newChatId),
              is_bot: false,
              first_name: 'Test',
            },
            chat: { id: parseInt(newChatId), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: `/start ${testMerchant.username}`,
          },
        })
        .expect(200);

      expect(response.body).toEqual({ received: true });

      // Verify database was updated to new chat_id
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, testMerchant.id));

      expect(merchant.telegramChatId).toBe(newChatId);
    });
  });

  describe('DELETE /api/v1/admin/telegram/disconnect (Merchant Dashboard)', () => {
    it('should reject request without JWT token (401)', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/admin/telegram/disconnect')
        .expect(401);
    });

    it('should successfully disconnect Telegram (200)', async () => {
      const response = await request(app.getHttpServer())
        .delete('/api/v1/admin/telegram/disconnect')
        .set('Authorization', `Bearer ${merchantJwt}`)
        .expect(200);

      // Verify response
      expect(response.body).toEqual({
        success: true,
        message: 'Telegram disconnected successfully',
      });

      // Verify database was cleared
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, testMerchant.id));

      expect(merchant.telegramChatId).toBeNull();
    });
  });

  describe('GET /api/v1/admin/telegram/status (Connection Status)', () => {
    it('should reject request without JWT token (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/telegram/status')
        .expect(401);
    });

    it('should return disconnected status when no chat_id (200)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/telegram/status')
        .set('Authorization', `Bearer ${merchantJwt}`)
        .expect(200);

      expect(response.body).toEqual({
        connected: false,
        connectedAt: null,
        chatId: null,
      });
    });

    it('should return connected status with masked chat_id (200)', async () => {
      // First reconnect telegram
      const chatId = '9876543210';
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', botSecret)
        .send({
          update_id: 10003,
          message: {
            message_id: 3,
            from: { id: parseInt(chatId), is_bot: false, first_name: 'Test' },
            chat: { id: parseInt(chatId), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: `/start ${testMerchant.username}`,
          },
        })
        .expect(200);

      // Now check status
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/telegram/status')
        .set('Authorization', `Bearer ${merchantJwt}`)
        .expect(200);

      expect(response.body.connected).toBe(true);
      expect(response.body.connectedAt).toBeDefined();
      // Chat ID should be masked: first 4 + ... + last 4 chars
      expect(response.body.chatId).toBe('9876...3210');
    });
  });

  describe('Telegram Connection Flow (Complete User Journey)', () => {
    it('should handle complete connect → check status → disconnect → check status flow', async () => {
      // Step 1: Connect Telegram
      const chatId = '5555666677';
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', botSecret)
        .send({
          update_id: 10004,
          message: {
            message_id: 4,
            from: { id: parseInt(chatId), is_bot: false, first_name: 'Test' },
            chat: { id: parseInt(chatId), type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: `/start ${testMerchant.username}`,
          },
        })
        .expect(200);

      // Step 2: Check status (should be connected)
      const statusResponse1 = await request(app.getHttpServer())
        .get('/api/v1/admin/telegram/status')
        .set('Authorization', `Bearer ${merchantJwt}`)
        .expect(200);

      expect(statusResponse1.body.connected).toBe(true);
      expect(statusResponse1.body.chatId).toBe('5555...6677');

      // Step 3: Disconnect
      const disconnectResponse = await request(app.getHttpServer())
        .delete('/api/v1/admin/telegram/disconnect')
        .set('Authorization', `Bearer ${merchantJwt}`)
        .expect(200);

      expect(disconnectResponse.body.success).toBe(true);

      // Step 4: Check status again (should be disconnected)
      const statusResponse2 = await request(app.getHttpServer())
        .get('/api/v1/admin/telegram/status')
        .set('Authorization', `Bearer ${merchantJwt}`)
        .expect(200);

      expect(statusResponse2.body.connected).toBe(false);
      expect(statusResponse2.body.chatId).toBeNull();
    });
  });
});
