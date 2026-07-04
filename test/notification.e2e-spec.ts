import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import * as crypto from 'crypto';
import { AppModule } from './../src/app.module';
import { DRIZZLE_PROVIDER } from './../src/database/database.provider';
import { merchants, apiKeys } from './../src/database/schema';
import { eq } from 'drizzle-orm';

describe('Notification Module (e2e)', () => {
  let app: INestApplication<App>;
  let db: any;
  let jwtService: JwtService;
  let merchantJwt: string;
  const botSecret = 'dev_bot_secret_test_key_123';

  const testMerchant = {
    id: 'merchant-notification-test',
    name: 'Notification Test Merchant',
    email: 'notification-test@merchant.com',
    defaultRedirectUrl: 'https://lemni.com',
    telegramChatId: null,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get(DRIZZLE_PROVIDER);
    jwtService = moduleFixture.get(JwtService);

    // Clean and seed test merchant
    await db.delete(apiKeys);
    await db.delete(merchants);

    await db.insert(merchants).values(testMerchant);

    // Generate JWT token for merchant dashboard (admin endpoints)
    merchantJwt = jwtService.sign(
      { sub: testMerchant.id, email: testMerchant.email },
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    await db.delete(apiKeys);
    await db.delete(merchants);
    await app.close();
  });

  describe('POST /api/v1/admin/telegram/connect (Bot Connection)', () => {
    it('should reject request with missing required fields (400)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: testMerchant.id,
          // missing chatId, signature, timestamp
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject request with invalid/stale timestamp (400)', async () => {
      const staleTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes old
      const chatId = '123456789';
      const signingString = `${testMerchant.id}:${chatId}:${staleTimestamp}`;
      const signature = crypto
        .createHmac('sha256', botSecret)
        .update(signingString)
        .digest('hex');

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: testMerchant.id,
          chatId,
          signature,
          timestamp: staleTimestamp,
        })
        .expect(400);

      expect(response.body.message).toContain('timestamp');
    });

    it('should reject request with invalid signature (401)', async () => {
      const timestamp = String(Date.now());
      const chatId = '123456789';

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: testMerchant.id,
          chatId,
          signature: 'invalid_signature_not_matching',
          timestamp,
        })
        .expect(401);

      expect(response.body.message).toContain('signature');
    });

    it('should reject request for non-existent merchant (400)', async () => {
      const timestamp = String(Date.now());
      const chatId = '123456789';
      const signingString = `merchant-nonexistent:${chatId}:${timestamp}`;
      const signature = crypto
        .createHmac('sha256', botSecret)
        .update(signingString)
        .digest('hex');

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: 'merchant-nonexistent',
          chatId,
          signature,
          timestamp,
        })
        .expect(400);

      expect(response.body.message).toContain('Merchant not found');
    });

    it('should successfully connect Telegram with valid signature (200)', async () => {
      const timestamp = String(Date.now());
      const chatId = '987654321';
      const signingString = `${testMerchant.id}:${chatId}:${timestamp}`;
      const signature = crypto
        .createHmac('sha256', botSecret)
        .update(signingString)
        .digest('hex');

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: testMerchant.id,
          chatId,
          signature,
          timestamp,
        })
        .expect(200);

      // Verify response
      expect(response.body).toEqual({
        success: true,
        message: 'Telegram chat connected successfully',
      });

      // Verify database was updated
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, testMerchant.id));

      expect(merchant.telegramChatId).toBe(chatId);
    });

    it('should update existing Telegram connection with new chat_id (200)', async () => {
      const timestamp = String(Date.now());
      const newChatId = '111222333';
      const signingString = `${testMerchant.id}:${newChatId}:${timestamp}`;
      const signature = crypto
        .createHmac('sha256', botSecret)
        .update(signingString)
        .digest('hex');

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: testMerchant.id,
          chatId: newChatId,
          signature,
          timestamp,
        })
        .expect(200);

      expect(response.body.success).toBe(true);

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
      const timestamp = String(Date.now());
      const chatId = '9876543210';
      const signingString = `${testMerchant.id}:${chatId}:${timestamp}`;
      const signature = crypto
        .createHmac('sha256', botSecret)
        .update(signingString)
        .digest('hex');

      await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: testMerchant.id,
          chatId,
          signature,
          timestamp,
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
      const connectTimestamp = String(Date.now());
      const chatId = '5555666677';
      const connectSigningString = `${testMerchant.id}:${chatId}:${connectTimestamp}`;
      const connectSignature = crypto
        .createHmac('sha256', botSecret)
        .update(connectSigningString)
        .digest('hex');

      const connectResponse = await request(app.getHttpServer())
        .post('/api/v1/admin/telegram/connect')
        .send({
          merchantId: testMerchant.id,
          chatId,
          signature: connectSignature,
          timestamp: connectTimestamp,
        })
        .expect(200);

      expect(connectResponse.body.success).toBe(true);

      // Step 2: Check status (should be connected)
      const statusResponse1 = await request(app.getHttpServer())
        .get('/api/v1/admin/telegram/status')
        .set('Authorization', `Bearer ${merchantJwt}`)
        .expect(200);

      expect(statusResponse1.body.connected).toBe(true);
      expect(statusResponse1.body.chatId).toBe('5555...7677');

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
