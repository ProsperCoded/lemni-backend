import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DRIZZLE_PROVIDER } from './../src/database/database.provider';
import { merchants, apiKeys } from './../src/database/schema';
import { AuthService } from './../src/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

describe('Security & Authentication (e2e)', () => {
  let app: INestApplication<App>;
  let db: any;
  let authService: AuthService;
  let jwtService: JwtService;

  const testMerchant = {
    id: 'merchant-test-123',
    name: 'Test Merchant',
    email: 'test@merchant.com',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get(DRIZZLE_PROVIDER);
    authService = moduleFixture.get(AuthService);
    jwtService = moduleFixture.get(JwtService);

    // Clean tables and seed test merchant
    await db.delete(apiKeys);
    await db.delete(merchants);
    await db.insert(merchants).values(testMerchant);
  });

  afterAll(async () => {
    // Clean up database records and close app
    await db.delete(apiKeys);
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

      expect(response.body.message).toBe('Invalid authorization scheme. Use Bearer <API_KEY>');
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
      await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, keyId));

      const response = await request(app.getHttpServer())
        .get('/test-api-key')
        .set('Authorization', `Bearer ${rawKey}`)
        .expect(401);

      expect(response.body.message).toBe('Invalid or inactive API key');

      // Reactivate key for subsequent tests
      await db.update(apiKeys).set({ isActive: true }).where(eq(apiKeys.id, keyId));
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
      jwtToken = jwtService.sign({ sub: testMerchant.id, email: testMerchant.email });
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
      const [keyRecord] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
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
});
