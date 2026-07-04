import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DRIZZLE_PROVIDER } from './../src/database/database.provider';
import {
  merchants,
  plans,
  customers,
  subscriptions,
  transactions,
} from './../src/database/schema';
import { ProrationService } from './../src/billing/proration.service';
import { BillingService } from './../src/billing/billing.service';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

describe('Billing & Domain Logic (e2e)', () => {
  jest.setTimeout(30000);
  let app: INestApplication<App>;
  let db: any;
  let prorationService: ProrationService;
  let billingService: BillingService;
  let jwtService: JwtService;
  let jwtToken: string;

  const testMerchant = {
    id: 'merchant-billing-test',
    name: 'Billing Test Merchant',
    email: 'billing-test@merchant.com',
    username: 'billing_test_merchant',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    db = moduleFixture.get(DRIZZLE_PROVIDER);
    prorationService = moduleFixture.get(ProrationService);
    billingService = moduleFixture.get(BillingService);
    jwtService = moduleFixture.get(JwtService);

    // Clean tables and seed test merchant
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);
    await db.insert(merchants).values(testMerchant);

    // Generate authenticated JWT token for the merchant
    jwtToken = jwtService.sign({
      sub: testMerchant.id,
      email: testMerchant.email,
    });
  });

  afterAll(async () => {
    await db.delete(transactions);
    await db.delete(subscriptions);
    await db.delete(customers);
    await db.delete(plans);
    await db.delete(merchants);
    await app.close();
  });

  describe('Proration Engine calculations', () => {
    it('should calculate correct adjustment on 50% cycle upgrade', () => {
      const periodStart = new Date('2026-07-01T00:00:00Z');
      const periodEnd = new Date('2026-07-31T00:00:00Z');
      const changeDate = new Date('2026-07-16T00:00:00Z'); // Exact mid-point (15 days elapsed, 15 remaining)

      const result = prorationService.calculateAdjustment(
        30, // Current plan: $30/month
        60, // New plan: $60/month
        periodStart,
        periodEnd,
        changeDate,
      );

      // Remaining cycle credit is 15 / 30 = 0.5 * $30 = $15
      expect(result.unusedFraction).toBeCloseTo(0.5, 2);
      expect(result.unusedCredit).toBe(15);
      // Net upgrade charge = $60 - $15 = $45
      expect(result.netCharge).toBe(45);
    });

    it('should calculate correct adjustment on mid-cycle downgrade', () => {
      const periodStart = new Date('2026-07-01T00:00:00Z');
      const periodEnd = new Date('2026-07-31T00:00:00Z');
      const changeDate = new Date('2026-07-16T00:00:00Z');

      const result = prorationService.calculateAdjustment(
        60, // Current plan: $60/month
        30, // New plan: $30/month
        periodStart,
        periodEnd,
        changeDate,
      );

      // Remaining cycle credit is 0.5 * $60 = $30
      expect(result.unusedCredit).toBe(30);
      // Net charge = $30 - $30 = $0 (fully covered by credit)
      expect(result.netCharge).toBe(0);
    });
  });

  describe('Plan and Customer Admin Endpoints', () => {
    let createdPlanId: string;
    let createdCustomerId: string;

    it('should create a plan via POST /admin/plans (201)', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/plans')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({
          name: 'Premium Plan',
          amount: 49.99,
          billingModel: 'recurring',
          interval: 'monthly',
          trialDays: 7,
          gracePeriodDays: 3,
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe('Premium Plan');
      createdPlanId = response.body.id;
    });

    it('should register a customer via POST /admin/customers (201)', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/customers')
        .set('Authorization', `Bearer ${jwtToken}`)
        .send({
          email: 'customer@test.com',
          metadata: { company: 'LemonInc' },
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.email).toBe('customer@test.com');
      createdCustomerId = response.body.id;
    });

    it('should block deletion of a plan if active subscriptions are attached (403)', async () => {
      // Seed a subscription on this plan
      await db.insert(subscriptions).values({
        id: 'sub-active-test-1',
        customerId: createdCustomerId,
        planId: createdPlanId,
        status: 'active',
        currentPeriodEnd: new Date('2026-08-01').toISOString(),
      });

      // Try deleting plan
      await request(app.getHttpServer())
        .delete(`/admin/plans/${createdPlanId}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });

    it('should delete a plan if no active subscriptions are attached (204)', async () => {
      // Delete the active subscription
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.id, 'sub-active-test-1'));

      await request(app.getHttpServer())
        .delete(`/admin/plans/${createdPlanId}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(204);

      // Verify deletion in DB
      const [planRecord] = await db
        .select()
        .from(plans)
        .where(eq(plans.id, createdPlanId));
      expect(planRecord).toBeUndefined();
    });
  });

  describe('Grace Period transitions', () => {
    it('should transition active subscription to past_due if past currentPeriodEnd but within grace period', async () => {
      // Create a plan with 3 days grace period
      const plan = await billingService.createPlan(testMerchant.id, {
        name: 'Grace Plan',
        amount: 10,
        gracePeriodDays: 3,
      });

      const customer = await billingService.registerCustomer(testMerchant.id, {
        email: 'grace-cust@test.com',
      });

      const subscriptionId = 'sub-grace-1';
      // Set currentPeriodEnd to 1 day ago (overdue but within 3 days grace period)
      const periodEnd = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();

      await db.insert(subscriptions).values({
        id: subscriptionId,
        customerId: customer.id,
        planId: plan.id,
        status: 'active',
        currentPeriodEnd: periodEnd,
      });

      const status =
        await billingService.evaluateSubscriptionGracePeriod(subscriptionId);
      expect(status).toBe('past_due');
    });

    it('should transition subscription to canceled if past grace period end', async () => {
      const plan = await billingService.createPlan(testMerchant.id, {
        name: 'Grace Plan 2',
        amount: 10,
        gracePeriodDays: 3,
      });

      const customer = await billingService.registerCustomer(testMerchant.id, {
        email: 'grace-cust-2@test.com',
      });

      const subscriptionId = 'sub-grace-2';
      // Set currentPeriodEnd to 4 days ago (grace period limit exceeded)
      const periodEnd = new Date(
        Date.now() - 4 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await db.insert(subscriptions).values({
        id: subscriptionId,
        customerId: customer.id,
        planId: plan.id,
        status: 'active',
        currentPeriodEnd: periodEnd,
      });

      const status =
        await billingService.evaluateSubscriptionGracePeriod(subscriptionId);
      expect(status).toBe('canceled');
    });
  });

  describe('Subscription Reactivation', () => {
    let plan: any;
    let customer: any;
    const subscriptionId = 'sub-reactivate-test';

    beforeAll(async () => {
      plan = await billingService.createPlan(testMerchant.id, {
        name: 'Reactivate Plan',
        amount: 20,
        interval: 'monthly',
      });

      customer = await billingService.registerCustomer(testMerchant.id, {
        email: 'reactivate-cust@test.com',
      });

      // Tokenize customer card
      await billingService.updateCustomerToken(customer.id, 'tok_test_card');
    });

    it('should successfully reactivate a canceled subscription (200)', async () => {
      // Seed a canceled subscription
      await db.insert(subscriptions).values({
        id: subscriptionId,
        customerId: customer.id,
        planId: plan.id,
        status: 'canceled',
        currentPeriodEnd: new Date('2026-06-01').toISOString(),
      });

      const response = await request(app.getHttpServer())
        .post(`/admin/subscriptions/${subscriptionId}/reactivate`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(response.body.status).toBe('active');
      expect(response.body.currentPeriodEnd).toBeDefined();

      // Verify db changes
      const [subRecord] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId));
      expect(subRecord.status).toBe('active');
    });

    it('should block reactivation if customer card is not tokenized (403)', async () => {
      const customerNoCard = await billingService.registerCustomer(
        testMerchant.id,
        {
          email: 'no-card-reactivate@test.com',
        },
      );

      const noCardSubId = 'sub-no-card-reactivate';
      await db.insert(subscriptions).values({
        id: noCardSubId,
        customerId: customerNoCard.id,
        planId: plan.id,
        status: 'canceled',
        currentPeriodEnd: new Date('2026-06-01').toISOString(),
      });

      await request(app.getHttpServer())
        .post(`/admin/subscriptions/${noCardSubId}/reactivate`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(403);
    });
  });

  describe('Transaction History & Filtering (GET /admin/transactions)', () => {
    let customerA: any;
    let customerB: any;
    let planA: any;
    let subA: any;
    let otherMerchant: any;
    let otherCustomer: any;

    beforeAll(async () => {
      // 1. Create plan, customer and subscription for testMerchant
      planA = await billingService.createPlan(testMerchant.id, {
        name: 'Plan A',
        amount: 50,
        interval: 'monthly',
      });

      customerA = await billingService.registerCustomer(testMerchant.id, {
        email: 'customer-a@test.com',
      });

      customerB = await billingService.registerCustomer(testMerchant.id, {
        email: 'customer-b@test.com',
      });

      subA = {
        id: 'sub-test-history-a',
        customerId: customerA.id,
        planId: planA.id,
        status: 'active',
        currentPeriodEnd: new Date('2026-08-01').toISOString(),
      };
      await db.insert(subscriptions).values(subA);

      // 2. Create another merchant, customer and subscription for security tests
      otherMerchant = {
        id: 'other-merchant-id',
        name: 'Other Merchant',
        email: 'other@merchant.com',
        username: 'other_merchant_test',
      };
      await db.insert(merchants).values(otherMerchant);

      otherCustomer = await billingService.registerCustomer(otherMerchant.id, {
        email: 'other-customer@test.com',
      });

      // 3. Seed transactions
      await db.insert(transactions).values([
        {
          id: 'tx-1',
          merchantId: testMerchant.id,
          customerId: customerA.id,
          subscriptionId: subA.id,
          amount: 50,
          status: 'success',
          createdAt: '2026-07-04T10:00:00Z',
        },
        {
          id: 'tx-2',
          merchantId: testMerchant.id,
          customerId: customerA.id,
          subscriptionId: subA.id,
          amount: 50,
          status: 'failed',
          createdAt: '2026-07-04T11:00:00Z',
        },
        {
          id: 'tx-3',
          merchantId: testMerchant.id,
          customerId: customerB.id,
          amount: 100, // One-time payment
          status: 'pending',
          createdAt: '2026-07-04T12:00:00Z',
        },
        {
          id: 'tx-other',
          merchantId: otherMerchant.id,
          customerId: otherCustomer.id,
          amount: 200,
          status: 'success',
          createdAt: '2026-07-04T13:00:00Z',
        },
      ]);
    });

    afterAll(async () => {
      await db.delete(transactions);
      await db.delete(subscriptions);
      await db.delete(customers);
      await db.delete(plans);
      await db.delete(merchants).where(eq(merchants.id, otherMerchant.id));
    });

    it('should retrieve all transactions for authenticated merchant with correct pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/transactions')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // Should return 3 transactions (tx-1, tx-2, tx-3), excluding tx-other
      expect(response.body.data.length).toBe(3);
      expect(response.body.pagination.total).toBe(3);
      expect(response.body.data[0].id).toBe('tx-3'); // desc order
    });

    it('should filter transactions by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/transactions?status=success')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].id).toBe('tx-1');
    });

    it('should filter transactions by customerId', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/transactions?customerId=${customerA.id}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(2);
      expect(response.body.data.map((tx: any) => tx.id)).toContain('tx-1');
      expect(response.body.data.map((tx: any) => tx.id)).toContain('tx-2');
    });

    it('should filter transactions by subscriptionId', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/transactions?subscriptionId=${subA.id}`)
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(2);
    });

    it('should filter transactions by date range', async () => {
      const response = await request(app.getHttpServer())
        .get(
          '/admin/transactions?startDate=2026-07-04T10:30:00Z&endDate=2026-07-04T12:30:00Z',
        )
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      // Should return tx-2 (11:00) and tx-3 (12:00)
      expect(response.body.data.length).toBe(2);
      expect(response.body.data.map((tx: any) => tx.id)).toContain('tx-2');
      expect(response.body.data.map((tx: any) => tx.id)).toContain('tx-3');
    });

    it('should enforce pagination limit and offset', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/transactions?limit=1&offset=1')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].id).toBe('tx-2'); // second element in desc order
      expect(response.body.pagination.total).toBe(3);
    });
  });
});
