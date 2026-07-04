import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DRIZZLE_PROVIDER } from './../src/database/database.provider';
import {
  merchants,
  apiKeys,
  otpVerifications,
  dlqJobs,
  transactions,
  subscriptions,
  customers,
  plans,
} from './../src/database/schema';
import { AuthService } from './../src/auth/auth.service';
import { EmailService } from './../src/common/services/email.service';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';

describe('Security & Authentication (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication<App>;
  let db: any;
  let authService: AuthService;
  let jwtService: JwtService;

  const testMerchant = {
    id: 'merchant-test-123',
    name: 'Test Merchant',
    email: 'test@merchant.com',
    username: 'auth_test_merchant',
  };

  const rawDefaultPassword = 'OldSecurePassword123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get(DRIZZLE_PROVIDER);
    authService = moduleFixture.get(AuthService);
    jwtService = moduleFixture.get(JwtService);

    const emailService = moduleFixture.get(EmailService);
    jest.spyOn(emailService, 'sendEmail').mockResolvedValue(true);

    // Clean ALL tables in FK order before seeding
    await db.delete(otpVerifications);
    await db.delete(dlqJobs);
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(apiKeys);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);

    const hashed = await bcrypt.hash(rawDefaultPassword, 10);
    await db.insert(merchants).values({
      ...testMerchant,
      hashedPassword: hashed,
    });
  });

  afterAll(async () => {
    await db.delete(otpVerifications);
    await db.delete(dlqJobs);
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(apiKeys);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);
    await app.close();
  });

  describe('API Key Authentication Guard', () => {
    let rawKey: string;
    let keyId: string;
    let secretPart: string;

    beforeAll(async () => {
      const generated = authService.generateApiKey('test');
      rawKey = generated.rawKey;
      keyId = generated.keyId;
      secretPart = generated.secretPart;

      const hashedKey = await authService.hashSecret(secretPart);
      await db.insert(apiKeys).values({
        id: keyId,
        merchantId: testMerchant.id,
        hashedKey,
        environment: 'test',
        isActive: true,
      });
    });

    it('should reject requests with missing authorization header (401)', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-api-key')
        .expect(401);

      expect(response.body.message).toBe('Missing authorization header');
    });

    it('should reject requests with invalid authorization scheme (401)', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-api-key')
        .set('Authorization', `Basic ${rawKey}`)
        .expect(401);

      expect(response.body.message).toBe(
        'Invalid authorization scheme. Use Bearer <API_KEY>',
      );
    });

    it('should reject requests with invalid/incorrect key (401)', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-api-key')
        .set('Authorization', 'Bearer sk_test_invalid_key')
        .expect(401);

      expect(response.body.message).toBe('Invalid or inactive API key');
    });

    it('should authorize requests with valid Bearer API key (200)', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-api-key')
        .set('Authorization', `Bearer ${rawKey}`)
        .expect(200);

      expect(response.body.status).toBe('authorized');
    });

    it('should reject requests when API key is marked inactive (401)', async () => {
      // Deactivate key
      await db
        .update(apiKeys)
        .set({ isActive: false })
        .where(eq(apiKeys.id, keyId));

      const response = await request(app.getHttpServer())
        .get('/test-api-key')
        .set('Authorization', `Bearer ${rawKey}`)
        .expect(401);

      expect(response.body.message).toBe('Invalid or inactive API key');

      // Reactivate key for subsequent tests
      await db
        .update(apiKeys)
        .set({ isActive: true })
        .where(eq(apiKeys.id, keyId));
    });
  });

  describe('JWT Guard & API Key Revocation Endpoint', () => {
    let rawKey: string;
    let keyId: string;
    let secretPart: string;
    let jwtToken: string;

    beforeAll(async () => {
      const generated = authService.generateApiKey('test');
      rawKey = generated.rawKey;
      keyId = generated.keyId;
      secretPart = generated.secretPart;

      const hashedKey = await authService.hashSecret(secretPart);
      await db.insert(apiKeys).values({
        id: keyId,
        merchantId: testMerchant.id,
        hashedKey,
        environment: 'test',
        isActive: true,
      });

      // Generate a mock JWT for our merchant
      jwtToken = jwtService.sign({
        sub: testMerchant.id,
        email: testMerchant.email,
      });
    });

    it('should reject revocation requests without valid JWT (401)', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/api-keys/${keyId}`)
        .expect(401);
    });

    it('should successfully revoke API key with valid JWT (200)', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/admin/api-keys/${keyId}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('API key successfully revoked');

      // Verify key is inactive in DB
      const [keyRecord] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId));
      expect(keyRecord.isActive).toBe(false);
    });

    it('should reject requests utilizing the newly revoked key (401)', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-api-key')
        .set('Authorization', `Bearer ${rawKey}`)
        .expect(401);

      expect(response.body.message).toBe('Invalid or inactive API key');
    });
  });

  describe('Password Reset Flow', () => {
    it('should reset password successfully with valid old password and new password', async () => {
      // Perform reset
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email: testMerchant.email,
          oldPassword: rawDefaultPassword,
          newPassword: 'NewSecurePassword123',
        })
        .expect(200);

      // Verify log in works with new password
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testMerchant.email, password: 'NewSecurePassword123' })
        .expect(200);

      expect(loginResponse.body.accessToken).toBeDefined();

      // Reset it back to default for other tests
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email: testMerchant.email,
          oldPassword: 'NewSecurePassword123',
          newPassword: rawDefaultPassword,
        })
        .expect(200);
    });

    it('should reject reset with incorrect old password (400)', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email: testMerchant.email,
          oldPassword: 'wrong_old_password',
          newPassword: 'NewSecurePassword123',
        })
        .expect(400);
    });

    it('should reject reset with nonexistent email (400)', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email: 'nonexistent@merchant.com',
          oldPassword: rawDefaultPassword,
          newPassword: 'NewSecurePassword123',
        })
        .expect(400);
    });

    it('should reject reset with weak new password (400)', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email: testMerchant.email,
          oldPassword: rawDefaultPassword,
          newPassword: 'short',
        })
        .expect(400);
    });
  });

  describe('Forgot Password Flow (OTP + Reset Token)', () => {
    it('should respond with success message for forgot password request (200)', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: testMerchant.email })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain(
        'password reset code has been sent',
      );

      // Verify OTP is generated in the database
      const merchantRecord = await db
        .select()
        .from(merchants)
        .where(eq(merchants.email, testMerchant.email));

      const [otpRecord] = await db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.merchantId, merchantRecord[0].id));

      expect(otpRecord).toBeDefined();
      expect(otpRecord.code).toHaveLength(6);
    });

    it('should reject OTP verification with incorrect code (400)', async () => {
      await request(app.getHttpServer())
        .post('/auth/verify-reset-otp')
        .send({
          email: testMerchant.email,
          code: '000000',
        })
        .expect(400);
    });

    it('should successfully verify OTP and return a reset token (200)', async () => {
      const merchantRecord = await db
        .select()
        .from(merchants)
        .where(eq(merchants.email, testMerchant.email));

      const [otpRecord] = await db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.merchantId, merchantRecord[0].id));

      const response = await request(app.getHttpServer())
        .post('/auth/verify-reset-otp')
        .send({
          email: testMerchant.email,
          code: otpRecord.code,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();

      // Now reset password using the token
      const newPassword = 'BrandNewPassword123!';
      const resetResponse = await request(app.getHttpServer())
        .post('/auth/reset-password-with-token')
        .send({
          token: response.body.token,
          newPassword,
        })
        .expect(200);

      expect(resetResponse.body.success).toBe(true);

      // Verify merchant can login with new password
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testMerchant.email,
          password: newPassword,
        })
        .expect(200);

      expect(loginResponse.body.accessToken).toBeDefined();
    });
  });
});
