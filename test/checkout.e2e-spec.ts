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
  otpVerifications,
} from './../src/database/schema';
import { NombaClient } from './../src/provider/nomba.client';
import { AuthService } from './../src/auth/auth.service';
import { EmailService } from './../src/common/services/email.service';
import { eq } from 'drizzle-orm';

describe('Checkout Module (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication<App>;
  let db: any;
  let authService: AuthService;
  let nombaClient: NombaClient;
  let rawApiKey: string;

  const testMerchant = {
    id: 'merchant-checkout-test',
    name: 'Checkout Test Merchant',
    email: 'checkout-test@merchant.com',
    username: 'checkout_test_merchant',
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

    const emailService = moduleFixture.get(EmailService);
    jest.spyOn(emailService, 'sendEmail').mockResolvedValue(true);

    // Clean tables and seed test merchant
    await db.delete(otpVerifications);
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
        orderReference: 'mock_order_ref_123',
      },
    });
  });

  afterAll(async () => {
    await db.delete(otpVerifications);
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
      const [cust] = await db
        .insert(customers)
        .values({
          id: 'cust-status-poll-test',
          merchantId: testMerchant.id,
          email: 'status-poll@test.com',
        })
        .returning();

      await db.insert(transactions).values({
        id: txId,
        merchantId: testMerchant.id,
        customerId: cust.id,
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

  describe('Customer Self-Unsubscribe Flow (Email OTP Validation)', () => {
    let subId: string;
    let customerEmail: string;

    beforeAll(async () => {
      subId = 'sub-unsubscribe-test';
      customerEmail = 'customer-to-unsubscribe@test.com';

      // Create a customer
      const [cust] = await db
        .insert(customers)
        .values({
          id: 'cust-unsubscribe-test',
          merchantId: testMerchant.id,
          email: customerEmail,
        })
        .returning();

      // Create plan
      const [plan] = await db
        .insert(plans)
        .values({
          id: 'plan-unsubscribe-test',
          merchantId: testMerchant.id,
          name: 'Unsubscribe Test Plan',
          amount: 25,
          billingModel: 'recurring',
          interval: 'monthly',
        })
        .returning();

      // Create subscription
      await db.insert(subscriptions).values({
        id: subId,
        customerId: cust.id,
        planId: plan.id,
        status: 'active',
      });
    });

    it('should reject unsubscribe request for wrong email (403)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/public/subscriptions/${subId}/unsubscribe/request`)
        .send({ email: 'wrong-email@test.com' })
        .expect(403);
    });

    it('should successfully request unsubscribe and generate OTP (200)', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/public/subscriptions/${subId}/unsubscribe/request`)
        .send({ email: customerEmail })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Verification code sent');

      // Verify OTP is saved in database
      const [otpRecord] = await db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.subscriptionId, subId));

      expect(otpRecord).toBeDefined();
      expect(otpRecord.code).toHaveLength(6);
    });

    it('should reject verification with incorrect OTP code (400)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/public/subscriptions/${subId}/unsubscribe/confirm`)
        .send({ code: '999999' }) // wrong code
        .expect(400);
    });

    it('should successfully unsubscribe customer with correct OTP code (200)', async () => {
      // Get the correct code from the db
      const [otpRecord] = await db
        .select()
        .from(otpVerifications)
        .where(eq(otpVerifications.subscriptionId, subId));

      const response = await request(app.getHttpServer())
        .post(`/api/v1/public/subscriptions/${subId}/unsubscribe/confirm`)
        .send({ code: otpRecord.code })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('successfully canceled');

      // Verify subscription status is canceled in db
      const [subRecord] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subId));

      expect(subRecord.status).toBe('canceled');
    });

    it('should reject confirmation if subscription is already canceled (400)', async () => {
      // Seed another OTP
      await db.insert(otpVerifications).values({
        id: 'otp-already-canceled',
        subscriptionId: subId,
        code: '123456',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });

      await request(app.getHttpServer())
        .post(`/api/v1/public/subscriptions/${subId}/unsubscribe/confirm`)
        .send({ code: '123456' })
        .expect(400);
    });
  });
});
