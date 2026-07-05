import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Telegram Webhook Flow (e2e)', () => {
  let app: INestApplication;
  let merchantId: string;
  let merchantUsername: string;
  let merchantEmail: string;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Telegram Deep Link Generation', () => {
    it('should generate Telegram deep link with merchant username during signup', async () => {
      merchantEmail = `telegram-test-${Date.now()}@example.com`;
      const signupRes = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          email: merchantEmail,
          password: 'SecurePassword123',
          name: 'Telegram Test Merchant',
        });

      expect(signupRes.status).toBe(201);
      expect(signupRes.body).toHaveProperty('id');
      expect(signupRes.body).toHaveProperty('username');
      expect(signupRes.body.username).toMatch(/^telegram-test-mercha/);

      merchantId = signupRes.body.id;
      merchantUsername = signupRes.body.username;
    });

    it('should login and retrieve access token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: merchantEmail,
          password: 'SecurePassword123',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body).toHaveProperty('accessToken');
      expect(loginRes.body).toHaveProperty('refreshToken');

      accessToken = loginRes.body.accessToken;
    });

    it('should get Telegram link with merchant username (not UUID)', async () => {
      const linkRes = await request(app.getHttpServer())
        .get('/auth/telegram-link')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(linkRes.status).toBe(200);
      expect(linkRes.body).toHaveProperty('telegramUrl');

      const url = linkRes.body.telegramUrl;
      expect(url).toContain('https://t.me/');
      expect(url).toContain('?start=');
      // URL-encodes the username in the query param
      expect(url).toMatch(/start=/);
      // Should NOT contain full UUID (it starts with specific format)
      expect(url).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    });

    it('should reject Telegram link request without JWT', async () => {
      const linkRes = await request(app.getHttpServer()).get(
        '/auth/telegram-link',
      );

      expect(linkRes.status).toBe(401);
    });

    it('should reject Telegram link request with invalid JWT', async () => {
      const linkRes = await request(app.getHttpServer())
        .get('/auth/telegram-link')
        .set('Authorization', 'Bearer invalid.token.here');

      expect(linkRes.status).toBe(401);
    });
  });

  describe('Telegram Webhook Handling (/start command)', () => {
    it('should handle valid /start command with merchant username', async () => {
      const telegramUpdate = {
        update_id: 123456,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 987654321,
            type: 'private',
          },
          text: `/start ${merchantUsername}`,
          from: {
            id: 987654321,
            is_bot: false,
            first_name: 'Test',
          },
        },
      };

      const webhookRes = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', process.env.TELEGRAM_BOT_SECRET!)
        .send(telegramUpdate);

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body).toHaveProperty('received', true);
    });

    it('should reject webhook without secret token', async () => {
      const telegramUpdate = {
        update_id: 123457,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 987654322,
            type: 'private',
          },
          text: `/start ${merchantUsername}`,
          from: {
            id: 987654322,
            is_bot: false,
            first_name: 'Test',
          },
        },
      };

      const webhookRes = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .send(telegramUpdate);

      expect(webhookRes.status).toBe(401);
    });

    it('should reject webhook with invalid secret token', async () => {
      const telegramUpdate = {
        update_id: 123458,
        message: {
          message_id: 3,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 987654323,
            type: 'private',
          },
          text: `/start ${merchantUsername}`,
          from: {
            id: 987654323,
            is_bot: false,
            first_name: 'Test',
          },
        },
      };

      const webhookRes = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', 'invalid-secret-token')
        .send(telegramUpdate);

      expect(webhookRes.status).toBe(401);
    });

    it('should handle /start command with invalid username gracefully', async () => {
      const telegramUpdate = {
        update_id: 123459,
        message: {
          message_id: 4,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 987654324,
            type: 'private',
          },
          text: '/start nonexistent-merchant-username',
          from: {
            id: 987654324,
            is_bot: false,
            first_name: 'Test',
          },
        },
      };

      const webhookRes = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', process.env.TELEGRAM_BOT_SECRET!)
        .send(telegramUpdate);

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body).toHaveProperty('received', true);
    });

    it('should ignore non-/start messages', async () => {
      const telegramUpdate = {
        update_id: 123460,
        message: {
          message_id: 5,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 987654325,
            type: 'private',
          },
          text: 'Hello bot',
          from: {
            id: 987654325,
            is_bot: false,
            first_name: 'Test',
          },
        },
      };

      const webhookRes = await request(app.getHttpServer())
        .post('/api/v1/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', process.env.TELEGRAM_BOT_SECRET!)
        .send(telegramUpdate);

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body).toHaveProperty('received', true);
    });
  });

  describe('Test Webhook Endpoint', () => {
    it('should accept test webhook and log payload', async () => {
      const testRes = await request(app.getHttpServer())
        .post('/api/v1/webhooks/test')
        .send({
          test: true,
          message: 'Test webhook payload',
        });

      expect(testRes.status).toBe(200);
      expect(testRes.body).toHaveProperty('received', true);
      expect(testRes.body).toHaveProperty('timestamp');
    });
  });
});
