import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DRIZZLE_PROVIDER } from './../src/database/database.provider';
import {
  merchants,
  apiKeys,
  plans,
  customers,
  subscriptions,
  transactions,
} from './../src/database/schema';
import { NombaClient } from './../src/provider/nomba.client';
import { AuthService } from './../src/auth/auth.service';
import { eq } from 'drizzle-orm';

describe('Checkout Module (e2e)', () => {
  let app: INestApplication<App>;
  let db: any;
  let authService: AuthService;
  let nombaClient: NombaClient;
  let rawApiKey: string;

  const testMerchant = {
    id: 'merchant-checkout-test',
    name: 'Checkout Test Merchant',
    email: 'checkout-test@merchant.com',
    defaultRedirectUrl: 'https://lemni.com/custom/success',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get(DRIZZLE_PROVIDER);
    authService = moduleFixture.get(AuthService);
    nombaClient = moduleFixture.get(NombaClient);

    // Clean tables and seed test merchant
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(apiKeys);
    await db.delete(merchants);

    await db.insert(merchants).values(testMerchant);

    // Generate API key for merchant
    const generated = authService.generateApiKey('test');
    rawApiKey = generated.rawKey;
    const hashedKey = await authService.hashSecret(generated.secretPart);

    await db.insert(apiKeys).values({
      id: generated.keyId,
      merchantId: testMerchant.id,
      hashedKey,
      environment: 'test',
      isActive: true,
    });

    // Mock Nomba checkout link generation
    jest.spyOn(nombaClient, 'createCheckoutOrder').mockResolvedValue({
      data: {
        checkoutLink: 'https://checkout.nomba.com/pay/mock_link_123',
      },
    });
  });

  afterAll(async () => {
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(apiKeys);
    await db.delete(merchants);
    await app.close();
  });

  describe('POST /api/v1/pay (One-Time Payment)', () => {
    it('should reject requests with missing authorization (401)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/pay')
        .send({ amount: 1500, email: 'one@time.com' })
        .expect(401);
    });

    it('should successfully create a checkout session and register customer dynamically (200)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/pay')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({
          amount: 5000,
          email: 'new-customer@checkout.com',
        })
        .expect(200);

      expect(response.body.sessionId).toBeDefined();
      expect(response.body.checkoutUrl).toBe(
        'https://checkout.nomba.com/pay/mock_link_123',
      );

      // Verify customer was dynamically created in DB
      const [customerRecord] = await db
        .select()
        .from(customers)
        .where(eq(customers.email, 'new-customer@checkout.com'));

      expect(customerRecord).toBeDefined();
      expect(customerRecord.merchantId).toBe(testMerchant.id);

      // Verify transaction was saved in DB
      const [txRecord] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, response.body.sessionId));

      expect(txRecord).toBeDefined();
      expect(txRecord.amount).toBe(5000);
      expect(txRecord.status).toBe('pending');
    });
  });

  describe('POST /api/v1/subscribe (Subscription Checkout)', () => {
    let planId: string;

    beforeAll(async () => {
      // Seed a subscription plan
      planId = 'plan-sub-checkout-test';
      await db.insert(plans).values({
        id: planId,
        merchantId: testMerchant.id,
        name: 'Basic Sub Plan',
        amount: 2500,
        billingModel: 'recurring',
        interval: 'monthly',
        trialDays: 0,
        gracePeriodDays: 3,
      });
    });

    it('should successfully create subscription checkout and pending records (200)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/subscribe')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({
          planId,
          email: 'subscriber@checkout.com',
        })
        .expect(200);

      expect(response.body.sessionId).toBeDefined();
      expect(response.body.subscriptionId).toBeDefined();
      expect(response.body.checkoutUrl).toBe(
        'https://checkout.nomba.com/pay/mock_link_123',
      );

      // Verify subscription record was created
      const [subRecord] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, response.body.subscriptionId));

      expect(subRecord).toBeDefined();
      expect(subRecord.status).toBe('active');

      // Verify pending transaction was created
      const [txRecord] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, response.body.sessionId));

      expect(txRecord).toBeDefined();
      expect(txRecord.subscriptionId).toBe(response.body.subscriptionId);
    });
  });

  describe('GET /api/v1/sessions/:id/status (Polling Status)', () => {
    it('should return session status detail successfully (200)', async () => {
      const txId = 'tx_status_poll_test';
      await db.insert(transactions).values({
        id: txId,
        amount: 3000,
        status: 'pending',
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sessions/${txId}/status`)
        .expect(200);

      expect(response.body.sessionId).toBe(txId);
      expect(response.body.status).toBe('pending');
    });
  });

  describe('POST /api/v1/checkout/plans/:planId/sessions (Public Plan Link)', () => {
    let publicPlanId: string;

    beforeAll(async () => {
      publicPlanId = 'plan-public-test';
      await db.insert(plans).values({
        id: publicPlanId,
        merchantId: testMerchant.id,
        name: 'Public Off The Shelf Plan',
        amount: 12000,
        billingModel: 'recurring',
        interval: 'yearly',
        trialDays: 7,
      });
    });

    it('should register checkout session for public link without API key credentials (200)', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/checkout/plans/${publicPlanId}/sessions`)
        .send({
          email: 'public-buyer@checkout.com',
        })
        .expect(200);

      expect(response.body.sessionId).toBeDefined();
      expect(response.body.checkoutUrl).toBe(
        'https://checkout.nomba.com/pay/mock_link_123',
      );

      // Verify subscription record status (should be trialing due to trialDays: 7)
      const [subRecord] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, response.body.subscriptionId));

      expect(subRecord).toBeDefined();
      expect(subRecord.status).toBe('trialing');
      expect(subRecord.trialEnd).toBeDefined();
    });
  });
});
